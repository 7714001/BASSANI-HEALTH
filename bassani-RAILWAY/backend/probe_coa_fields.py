"""
One-off, read-only investigation script — checks whether product.template
(and product.product) on the live Odoo instance already has a custom field
for a Certificate of Analysis (COA) URL, lab results, or cannabinoid content.

Does NOT write anything. Safe to run against production.

Usage:
    cd backend
    # requires a real .env (or real env vars) with ODOO_URL/ODOO_DB/
    # ODOO_USERNAME/ODOO_PASSWORD set — see .env.example
    python probe_coa_fields.py

Delete this file once you're done with it — it's a throwaway diagnostic,
not part of the app.
"""
import re
from odoo_client import odoo

KEYWORDS = re.compile(
    r"coa|certificate|lab.?result|cannabinoid|potency|\bthc\b|\bcbd\b|analysis|test.?result",
    re.IGNORECASE,
)

def probe(model):
    print(f"\n=== {model} — fields matching COA/lab/cannabinoid keywords ===")
    fields = odoo(model, "fields_get", [], {"attributes": ["string", "type", "help"]})
    matches = {
        name: meta for name, meta in fields.items()
        if KEYWORDS.search(name) or KEYWORDS.search(meta.get("string") or "") or KEYWORDS.search(meta.get("help") or "")
    }
    if not matches:
        print("  (no matching fields found)")
    for name, meta in sorted(matches.items()):
        print(f"  {name:35s} [{meta.get('type')}]  \"{meta.get('string')}\"")
        if meta.get("help"):
            print(f"      help: {meta['help']}")

    # Also list every custom field (x_studio_* / x_*) regardless of keyword
    # match, in case it's labelled something non-obvious (e.g. "Lab Sheet").
    custom = {n: m for n, m in fields.items() if n.startswith("x_")}
    if custom:
        print(f"\n  -- all custom (x_*) fields on {model}, for manual review --")
        for name, meta in sorted(custom.items()):
            print(f"  {name:35s} [{meta.get('type')}]  \"{meta.get('string')}\"")


def sample_values(model, field_names):
    if not field_names:
        return
    print(f"\n=== {model} — sample values from one real record ===")
    rows = odoo(model, "search_read", [[]], {"fields": field_names, "limit": 1})
    if not rows:
        print("  (no records found)")
        return
    for k, v in rows[0].items():
        if k == "id":
            continue
        print(f"  {k}: {v!r}")


if __name__ == "__main__":
    for model in ("product.template", "product.product"):
        probe(model)

    # Uncomment and fill in real field names found above to see a live example value:
    # sample_values("product.template", ["x_studio_coa_url"])
