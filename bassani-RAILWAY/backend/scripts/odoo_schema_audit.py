"""Odoo schema audit: check every Odoo name the backend uses against live Odoo.

Reads the backend source (AST, no imports of portal code), extracts every
model, field, domain value, method, report and context key the portal sends
to Odoo, and checks them against the live instance. Read-only: fields_get,
ir.model / ir.actions.report reads, and (only with --probe-methods) calls
on an EMPTY recordset, which can't touch any record.

Catches the drift classes that have bitten us on Odoo upgrades:
  - fields that no longer exist         (reserved_availability, 2026-08-11)
  - selection values that no longer exist (type = "product", 2026-10-13)
  - renamed context keys                 (warehouse -> warehouse_id, 2026-10-13)
  - removed / private methods            (_render_qweb_pdf, 2026-08-14)
  - renamed report templates             (report_saleorder_pro_forma_invoice)

What it cannot see: model/field names built at runtime (reported as
"unverified" counts), and wrong-but-valid names. Live behaviour still needs
testing after an upgrade; this narrows it to what's actually changed.

Usage (from backend/):
    python scripts/odoo_schema_audit.py                  # schema checks
    python scripts/odoo_schema_audit.py --probe-methods  # + method existence
Credentials: ODOO_URL / ODOO_DB / ODOO_USERNAME / ODOO_PASSWORD env vars,
else backend/.env. Exit code 1 if anything is flagged (usable in CI).
"""
import argparse
import ast
import os
import re
import sys
import xmlrpc.client
from collections import defaultdict
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent

# Call shapes ─────────────────────────────────────────────────────────────────
# (model, method, args_list, kwargs_dict) — execute_kw style
EXECUTE_KW_FUNCS = {"odoo", "odoo_call", "_odoo_call", "odoo_execute_kw", "_call", "execute_kw"}
# OdooClient.execute(model, method, *args)
EXECUTE_FUNCS = {"execute"}
# OdooClient / odoo_* helpers: (model, ...) with a fixed method
FIXED_METHOD_FUNCS = {
    "search_read": "search_read", "read": "read", "search": "search", "count": "search_count",
    "search_count": "search_count", "create": "create", "write": "write", "unlink": "unlink",
    "read_group": "read_group", "message_post": "message_post",
    "odoo_search_read": "search_read", "odoo_create": "create", "odoo_write": "write",
    "odoo_search_count": "search_count", "odoo_search": "search", "odoo_read": "read",
}
OdooClient_METHODS = {"search_read", "read", "search", "count", "create", "write", "unlink",
                      "execute", "message_post"}

ORM_METHODS = {"search_read", "read", "search", "search_count", "create", "write", "unlink",
               "read_group", "fields_get", "name_search", "default_get", "copy", "exists",
               "check_access_rights", "web_search_read", "web_read", "formatted_read_group"}
NEVER_PROBE = {"create", "write", "unlink", "copy"}

OPERATORS = {"=", "!=", "<>", "<", ">", "<=", ">=", "in", "not in", "like", "ilike",
             "not like", "not ilike", "=like", "=ilike", "child_of", "parent_of",
             "any", "not any", "=?"}

# Context keys Odoo has renamed/removed. Extend when an upgrade renames one.
DEPRECATED_CONTEXT_KEYS = {
    "warehouse": "renamed to 'warehouse_id' in Odoo 17; ignored silently on 18+",
    "force_company": "removed in Odoo 13; use 'allowed_company_ids'",
}

MODEL_RE = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$")
FIELD_PATH_RE = re.compile(r"^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)*$")
IMPLICIT_FIELDS = {"id"}


# Static extraction ───────────────────────────────────────────────────────────

def _func_name(call: ast.Call):
    f = call.func
    if isinstance(f, ast.Name):
        return f.id, None
    if isinstance(f, ast.Attribute):
        owner = f.value.id if isinstance(f.value, ast.Name) else (
            f.value.attr if isinstance(f.value, ast.Attribute) else None)
        return f.attr, owner
    return None, None


def _str(node):
    return node.value if isinstance(node, ast.Constant) and isinstance(node.value, str) else None


class Scope:
    """Collects simple assignments to names so variables like `domain`,
    `fields`, `vals` can be resolved back to the literals that built them."""

    def __init__(self, parent=None):
        self.parent = parent
        self.contrib = defaultdict(list)   # name -> [ast nodes]
        self.subkeys = defaultdict(list)   # name -> [(key, value_node, lineno)]

    def collect(self, body_node):
        for n in ast.walk(body_node):
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n is not body_node:
                continue
            if isinstance(n, ast.Assign):
                for t in n.targets:
                    if isinstance(t, ast.Name):
                        self.contrib[t.id].append(n.value)
                    elif isinstance(t, ast.Subscript) and isinstance(t.value, ast.Name):
                        k = _str(t.slice)
                        if k:
                            self.subkeys[t.value.id].append((k, n.value, n.lineno))
            elif isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name) and n.value:
                self.contrib[n.target.id].append(n.value)
            elif isinstance(n, ast.AugAssign) and isinstance(n.target, ast.Name):
                self.contrib[n.target.id].append(n.value)
            elif isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) \
                    and isinstance(n.func.value, ast.Name) \
                    and n.func.attr in ("append", "extend", "insert", "update") and n.args:
                self.contrib[n.func.value.id].append(n.args[-1])

    def lookup(self, name):
        s, out = self, []
        while s:
            out.extend(s.contrib.get(name, []))
            if out:
                break
            s = s.parent
        return out

    def lookup_subkeys(self, name):
        s = self
        while s:
            if name in s.subkeys:
                return s.subkeys[name]
            s = s.parent
        return []


def expand(node, scope, depth=0, seen=None):
    """Yield the literal nodes an expression is built from (names resolved,
    + concatenations and list(...) / dict(...) calls flattened)."""
    if node is None or depth > 6:
        return
    seen = seen or set()
    if isinstance(node, ast.Name):
        if node.id in seen:
            return
        for c in scope.lookup(node.id):
            yield from expand(c, scope, depth + 1, seen | {node.id})
        return
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        yield from expand(node.left, scope, depth + 1, seen)
        yield from expand(node.right, scope, depth + 1, seen)
        return
    if isinstance(node, ast.Starred):
        yield from expand(node.value, scope, depth + 1, seen)
        return
    if isinstance(node, ast.IfExp):
        yield from expand(node.body, scope, depth + 1, seen)
        yield from expand(node.orelse, scope, depth + 1, seen)
        return
    yield node


def domain_leaves(node, scope, depth=0):
    """(field_path, operator, value_or_None, lineno) for every domain leaf.
    Only follows names that are themselves part of the domain structure
    (`domain + extra`, `[*base, leaf]`), never names used as a leaf's value,
    which would drag in unrelated queries."""
    if depth > 6:
        return
    for n in expand(node, scope, depth):
        if not isinstance(n, (ast.Tuple, ast.List)):
            continue
        f = _str(n.elts[0]) if len(n.elts) == 3 else None
        op = _str(n.elts[1]) if len(n.elts) == 3 else None
        if f and op in OPERATORS and FIELD_PATH_RE.match(f):
            v = n.elts[2]
            val = None
            if isinstance(v, ast.Constant):
                val = v.value
            elif isinstance(v, (ast.List, ast.Tuple)) and v.elts \
                    and all(isinstance(e, ast.Constant) for e in v.elts):
                val = [e.value for e in v.elts]
            if op in ("any", "not any"):
                # sub-domain on the related model; not checked here
                val = None
            yield f, op, val, n.lineno
        else:
            for e in n.elts:
                yield from domain_leaves(e, scope, depth + 1)


def str_list(node, scope):
    out = []
    for n in expand(node, scope):
        if isinstance(n, (ast.List, ast.Tuple, ast.Set)):
            for e in n.elts:
                for x in expand(e, scope):
                    s = _str(x)
                    if s:
                        out.append((s, getattr(x, "lineno", n.lineno)))
        elif _str(n):
            out.append((_str(n), n.lineno))
    return out


def dict_items(node, scope):
    """(key, value_node, lineno) for a dict literal / dict-built variable."""
    out = []
    if isinstance(node, ast.Name):
        out.extend(scope.lookup_subkeys(node.id))
    for n in expand(node, scope):
        if isinstance(n, ast.Dict):
            for k, v in zip(n.keys, n.values):
                if k is None:          # **spread
                    out.extend(dict_items(v, scope))
                elif _str(k):
                    out.append((_str(k), v, k.lineno))
        elif isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "dict":
            for kw in n.keywords:
                if kw.arg:
                    out.append((kw.arg, kw.value, n.lineno))
        elif isinstance(n, (ast.List, ast.Tuple)):       # create([vals, ...])
            for e in n.elts:
                out.extend(dict_items(e, scope))
    return out


class Usage:
    def __init__(self):
        self.models = defaultdict(list)          # model -> [loc]
        self.fields = defaultdict(list)          # (model, path) -> [loc]
        self.values = defaultdict(list)          # (model, path, op, (values,)) -> [loc]
        self.write_values = defaultdict(list)    # (model, field, value) -> [loc]
        self.methods = defaultdict(list)         # (model, method) -> [loc]
        self.reports = defaultdict(list)         # report_name -> [loc]
        self.context_keys = defaultdict(list)    # key -> [loc]
        self.bad_client_methods = []             # (owner.attr, loc)
        self.calls = 0
        self.dynamic_calls = []                  # loc


def extract_call(call, scope, loc, u: Usage):
    name, owner = _func_name(call)
    if not name:
        return
    method = None
    args = list(call.args)
    kw = {k.arg: k.value for k in call.keywords if k.arg}

    if name in EXECUTE_KW_FUNCS or name in EXECUTE_FUNCS:
        if len(args) < 2:
            return
        model, method = _str(args[0]), _str(args[1])
        rest = args[2:]
        if name in EXECUTE_KW_FUNCS:
            pos = rest[0] if rest else kw.get("args")
            kws = rest[1] if len(rest) > 1 else kw.get("kwargs")
            pos_items = list(expand(pos, scope))
            pos_args = pos_items[0].elts if pos_items and isinstance(pos_items[0], (ast.List, ast.Tuple)) else []
            kw_items = dict(((k, v) for k, v, _ in dict_items(kws, scope))) if kws is not None else {}
        else:
            pos_args, kw_items = rest, {}
    elif name in FIXED_METHOD_FUNCS:
        if not args:
            return
        model = _str(args[0])
        if model is None and not isinstance(args[0], (ast.Name, ast.Attribute, ast.JoinedStr)):
            return
        method = FIXED_METHOD_FUNCS[name]
        pos_args = args[1:]
        kw_items = kw
    else:
        return

    if model is None:
        if args and isinstance(args[0], ast.Constant):
            return                                # not an Odoo call (e.g. str arg)
        u.dynamic_calls.append(loc)
        return
    if not MODEL_RE.match(model):
        return
    u.calls += 1
    u.models[model].append(loc)
    if method:
        u.methods[(model, method)].append(loc)

    def add_domain(node):
        for f, op, val, ln in domain_leaves(node, scope):
            u.fields[(model, f)].append(f"{loc[0]}:{ln}")
            if val is not None and op in ("=", "!=", "in", "not in"):
                vals = tuple(v for v in (val if isinstance(val, list) else [val]) if isinstance(v, str))
                if vals:
                    u.values[(model, f, op, vals)].append(f"{loc[0]}:{ln}")

    def add_fields(node):
        for s, ln in str_list(node, scope):
            u.fields[(model, s.split(":")[0])].append(f"{loc[0]}:{ln}")

    def add_order(node):
        s = _str(node)
        if s:
            for part in s.split(","):
                tok = part.strip().split(" ")[0]
                if tok:
                    u.fields[(model, tok)].append(f"{loc[0]}:{node.lineno}")

    def add_vals(node, prefix="", depth=0):
        for k, v, ln in dict_items(node, scope):
            if not FIELD_PATH_RE.match(k) or "." in k:
                continue
            path = prefix + k
            u.fields[(model, path)].append(f"{loc[0]}:{ln}")
            for vv in expand(v, scope):
                if isinstance(vv, ast.Constant) and isinstance(vv.value, str):
                    u.write_values[(model, path, vv.value)].append(f"{loc[0]}:{ln}")
                # x2many commands: [(0, 0, {vals}), (1, id, {vals})] -> check
                # the nested vals against the related model via a dotted path
                elif isinstance(vv, (ast.List, ast.Tuple)) and depth < 3:
                    for cmd in vv.elts:
                        if isinstance(cmd, (ast.Tuple, ast.List)) and len(cmd.elts) == 3 \
                                and isinstance(cmd.elts[0], ast.Constant) and cmd.elts[0].value in (0, 1):
                            add_vals(cmd.elts[2], path + ".", depth + 1)

    m = method
    if m in ("search_read", "search", "search_count", "read_group", "web_search_read", "formatted_read_group"):
        if pos_args:
            add_domain(pos_args[0])
        for key in ("domain", "args"):
            if key in kw_items:
                add_domain(kw_items[key])
        if m == "read_group":
            for p in pos_args[1:3]:
                add_fields(p)
            for key in ("groupby", "aggregates", "measures"):
                if key in kw_items:
                    add_fields(kw_items[key])
    elif m == "read":
        if len(pos_args) > 1:
            add_fields(pos_args[1])
    elif m == "create":
        if pos_args:
            add_vals(pos_args[0])
        if "vals" in kw_items:
            add_vals(kw_items["vals"])
    elif m == "write":
        if len(pos_args) > 1:
            add_vals(pos_args[1])
        if "vals" in kw_items:
            add_vals(kw_items["vals"])
    if "fields" in kw_items:
        add_fields(kw_items["fields"])
    if "order" in kw_items:
        add_order(kw_items["order"])
    if "context" in kw_items:
        for k, _v, ln in dict_items(kw_items["context"], scope):
            u.context_keys[k].append(f"{loc[0]}:{ln}")


def scan_file(path: Path, u: Usage):
    rel = path.relative_to(BACKEND).as_posix()
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=rel)
    module = Scope()
    module.collect(tree)

    def walk(node, scope):
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                s = Scope(scope)
                s.collect(child)
                walk(child, s)
            else:
                if isinstance(child, ast.Call):
                    loc = (rel, child.lineno)
                    extract_call(child, scope, loc, u)
                    name, owner = _func_name(child)
                    if name == "fetch_report_pdf" and child.args and _str(child.args[0]):
                        u.reports[_str(child.args[0])].append(f"{rel}:{child.lineno}")
                    # odoo-client attribute that doesn't exist on OdooClient
                    if owner in ("odoo", "_odoo", "client", "odoo_client") \
                            and isinstance(child.func, ast.Attribute) \
                            and name not in OdooClient_METHODS | {"read_group"} \
                            and child.args and _str(child.args[0]) and MODEL_RE.match(_str(child.args[0])):
                        u.bad_client_methods.append((f"{owner}.{name}", f"{rel}:{child.lineno}"))
                walk(child, scope)
    walk(tree, module)

    # Deprecated context keys anywhere: dict keys / subscript keys inside a
    # dict that is clearly a context (named ctx/context, or a "context" value).
    for n in ast.walk(tree):
        if isinstance(n, ast.Dict):
            for k, v in zip(n.keys, n.values):
                if _str(k) == "context" and isinstance(v, ast.Dict):
                    for kk in v.keys:
                        if _str(kk):
                            u.context_keys[_str(kk)].append(f"{rel}:{kk.lineno}")
        elif isinstance(n, ast.Assign):
            for t in n.targets:
                if isinstance(t, ast.Subscript) and isinstance(t.value, ast.Name) \
                        and re.search(r"ctx|context", t.value.id) and _str(t.slice):
                    u.context_keys[_str(t.slice)].append(f"{rel}:{n.lineno}")
                if isinstance(t, ast.Name) and re.search(r"ctx|context", t.id) and isinstance(n.value, ast.Dict):
                    for kk in n.value.keys:
                        if _str(kk):
                            u.context_keys[_str(kk)].append(f"{rel}:{kk.lineno}")
        elif isinstance(n, ast.keyword) and n.arg == "context" and isinstance(n.value, ast.Dict):
            for kk in n.value.keys:
                if _str(kk):
                    u.context_keys[_str(kk)].append(f"{rel}:{kk.lineno}")


def source_files():
    for p in sorted(BACKEND.rglob("*.py")):
        rp = p.relative_to(BACKEND).as_posix()
        if "__pycache__" in rp or rp.startswith("scripts/") or rp.startswith("static/"):
            continue
        if re.match(r"^(test_|probe_)", p.name):
            continue
        yield p


# Live checks ─────────────────────────────────────────────────────────────────

class Odoo:
    def __init__(self):
        cfg = {k: os.environ.get(k) for k in ("ODOO_URL", "ODOO_DB", "ODOO_USERNAME", "ODOO_PASSWORD")}
        if not all(cfg.values()):
            try:
                from dotenv import dotenv_values
                env = dotenv_values(BACKEND / ".env")
                cfg = {k: cfg[k] or env.get(k) for k in cfg}
            except ImportError:
                pass
        if not all(cfg.values()):
            sys.exit("Odoo credentials not found (ODOO_URL/DB/USERNAME/PASSWORD env or backend/.env)")
        self.url, self.db, user, self.pw = (cfg["ODOO_URL"].rstrip("/"), cfg["ODOO_DB"],
                                            cfg["ODOO_USERNAME"], cfg["ODOO_PASSWORD"])
        common = xmlrpc.client.ServerProxy(f"{self.url}/xmlrpc/2/common", allow_none=True)
        self.version = common.version().get("server_version")
        self.uid = common.authenticate(self.db, user, self.pw, {})
        if not self.uid:
            sys.exit("Odoo authentication failed")
        self.obj = xmlrpc.client.ServerProxy(f"{self.url}/xmlrpc/2/object", allow_none=True)
        self._fields = {}
        self._models = None

    def x(self, model, method, args, kw=None):
        return self.obj.execute_kw(self.db, self.uid, self.pw, model, method, args, kw or {})

    def model_exists(self, model):
        if self._models is None:
            rows = self.x("ir.model", "search_read", [[]], {"fields": ["model"]})
            self._models = {r["model"] for r in rows}
        return model in self._models

    def fields(self, model):
        if model not in self._fields:
            try:
                self._fields[model] = self.x(model, "fields_get", [], {"attributes": ["type", "relation", "selection"]})
            except xmlrpc.client.Fault:
                self._fields[model] = None
        return self._fields[model]

    def resolve(self, model, path):
        """Return (field_def, error) for a dotted path."""
        cur = model
        parts = path.split(".")
        for i, p in enumerate(parts):
            fs = self.fields(cur)
            if fs is None:
                return None, f"model '{cur}' not readable"
            if p not in fs and p not in IMPLICIT_FIELDS:
                where = f" (on {cur}, via '{'.'.join(parts[:i])}')" if i else ""
                return None, f"field '{p}' does not exist{where}"
            fd = fs.get(p, {"type": "integer"})
            if i < len(parts) - 1:
                if not fd.get("relation"):
                    return None, f"'{p}' on {cur} is not a relation, can't follow '.{parts[i+1]}'"
                cur = fd["relation"]
        return fd, None

    def probe_method(self, model, method):
        try:
            self.x(model, method, [[]])
            return None
        except xmlrpc.client.Fault as e:
            s = e.faultString
            if "does not exist" in s and method in s:
                return "method does not exist"
            if "Private methods" in s or "cannot be called remotely" in s:
                return "private method, refused over XML-RPC"
            return None      # any other error = method exists, just unhappy with no records
        except Exception:
            return None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--probe-methods", action="store_true",
                    help="also check every called method exists (calls it on an empty recordset)")
    ap.add_argument("--verbose", action="store_true", help="list every location, not just the first 3")
    a = ap.parse_args()

    u = Usage()
    for p in source_files():
        try:
            scan_file(p, u)
        except SyntaxError as e:
            print(f"!! could not parse {p}: {e}")

    o = Odoo()
    problems = defaultdict(list)

    def locs(lst):
        lst = sorted(set(map(lambda t: t if isinstance(t, str) else f"{t[0]}:{t[1]}", lst)))
        return ", ".join(lst if a.verbose else lst[:3]) + ("" if a.verbose or len(lst) <= 3 else f" (+{len(lst)-3} more)")

    for model, l in sorted(u.models.items()):
        if not o.model_exists(model):
            problems["Missing model"].append(f"{model}  [{locs(l)}]")

    for (model, path), l in sorted(u.fields.items()):
        if not o.model_exists(model):
            continue
        _fd, err = o.resolve(model, path)
        if err:
            problems["Unknown field"].append(f"{model}.{path}: {err}  [{locs(l)}]")

    def selection_keys(model, path):
        if not o.model_exists(model):
            return None
        fd, err = o.resolve(model, path)
        if err or not fd or fd.get("type") != "selection" or not isinstance(fd.get("selection"), list):
            return None
        return [k for k, _ in fd["selection"]]

    warnings = defaultdict(list)
    for (model, path, op, vals), l in sorted(u.values.items()):
        valid = selection_keys(model, path)
        if valid is None:
            continue
        bad = [v for v in vals if v not in valid]
        if not bad:
            continue
        line = (f"{model}.{path} {op} {list(vals)}: '{', '.join(bad)}' no longer exists "
                f"(valid: {', '.join(map(str, valid))})  [{locs(l)}]")
        if op in ("in", "not in") and len(bad) < len(vals):
            # e.g. state in ["sale", "done"]: still works, "done" just never matches
            warnings["Stale selection value (harmless, other values still match)"].append(line)
        else:
            problems["Invalid selection value in a filter (never matches / always matches)"].append(line)
    for (model, f, v), l in sorted(u.write_values.items()):
        valid = selection_keys(model, f)
        if valid is not None and v not in valid:
            problems["Invalid selection value written"].append(
                f"{model}.{f} = '{v}' (valid: {', '.join(map(str, valid))})  [{locs(l)}]")

    for key, l in sorted(u.context_keys.items()):
        if key in DEPRECATED_CONTEXT_KEYS:
            problems["Deprecated context key"].append(f"'{key}': {DEPRECATED_CONTEXT_KEYS[key]}  [{locs(l)}]")

    if u.reports:
        names = list(u.reports)
        found = {r["report_name"] for r in o.x("ir.actions.report", "search_read",
                                               [[("report_name", "in", names)]], {"fields": ["report_name"]})}
        for rn in names:
            if rn not in found:
                problems["Missing report"].append(f"{rn}  [{locs(u.reports[rn])}]")

    for meth, loc in u.bad_client_methods:
        problems["Call to a method OdooClient doesn't have"].append(f"{meth}()  [{loc}]")

    probed = 0
    if a.probe_methods:
        for (model, method), l in sorted(u.methods.items()):
            if method in ORM_METHODS or method in NEVER_PROBE or not o.model_exists(model):
                continue
            probed += 1
            err = o.probe_method(model, method)
            if err:
                problems["Method problem"].append(f"{model}.{method}: {err}  [{locs(l)}]")

    print(f"Odoo {o.version} at {o.url} (db {o.db})")
    print(f"Scanned {sum(1 for _ in source_files())} files: {u.calls} Odoo calls, {len(u.models)} models, "
          f"{len(u.fields)} field references, {len(u.values) + len(u.write_values)} selection values, "
          f"{len(u.methods)} model methods{f' ({probed} probed)' if a.probe_methods else ''}, "
          f"{len(u.reports)} reports, {len(u.context_keys)} context keys")
    if u.dynamic_calls:
        print(f"{len(u.dynamic_calls)} calls use a model name built at runtime and were not checked")
    if not a.probe_methods:
        print("Methods not checked (run with --probe-methods)")
    print()
    for cat, items in warnings.items():
        print(f"-- {cat} ({len(items)})")
        for i in items:
            print(f"   {i}")
        print()
    if not problems:
        print("OK: no schema drift found." + (" (warnings above don't fail the run)" if warnings else ""))
        return 0
    for cat, items in problems.items():
        print(f"== {cat} ({len(items)})")
        for i in items:
            print(f"   {i}")
        print()
    return 1


if __name__ == "__main__":
    sys.exit(main())
