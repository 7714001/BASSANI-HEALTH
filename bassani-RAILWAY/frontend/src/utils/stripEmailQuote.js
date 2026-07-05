/**
 * Strips the quoted reply chain from an inbound HTML email body.
 *
 * Handles: Gmail, Apple Mail/Thunderbird (blockquote), Outlook with divRplyFwdMsg,
 * Outlook/Word with CSS border-top div (no <hr>), Yahoo Mail, and generic <hr>.
 *
 * Returns:
 *   { body: string, hasQuote: boolean, quoteHtml: string }
 *
 * Only call this on inbound messages — outgoing portal replies are already clean.
 */
export function stripEmailQuote(html) {
  if (!html) return { body: "", hasQuote: false, quoteHtml: "" };

  const div = document.createElement("div");
  div.innerHTML = html;

  let hasQuote = false;
  let quoteHtml = "";

  // Removes el AND all following siblings within its parent.
  // Use when the quoted content follows OUTSIDE the matched element
  // (e.g. Outlook: header div is followed by the original email as a sibling).
  const snipFrom = (el) => {
    const parts = [el.outerHTML || ""];
    let sibling = el.nextSibling;
    while (sibling) {
      const nx = sibling.nextSibling;
      parts.push(sibling.outerHTML || sibling.textContent || "");
      sibling.remove();
      sibling = nx;
    }
    el.remove();
    quoteHtml = parts.join("");
    hasQuote = true;
  };

  // Removes only el — use when el contains the entire quoted thread inside itself.
  const snip = (el) => {
    quoteHtml = el.outerHTML || "";
    el.remove();
    hasQuote = true;
  };

  // 1. Gmail: .gmail_attr attribution + .gmail_quote block
  const gmailQuote = div.querySelector(".gmail_quote");
  if (gmailQuote) {
    const attr = div.querySelector(".gmail_attr");
    if (attr) attr.remove();
    snip(gmailQuote);
  }

  // 2. Standard blockquote — Apple Mail, Thunderbird, RFC-compliant clients
  if (!hasQuote) {
    const bq = div.querySelector("blockquote");
    if (bq) {
      const prev = bq.previousElementSibling;
      if (prev && /on\s.{4,160}\swrote:/i.test(prev.textContent)) prev.remove();
      snip(bq);
    }
  }

  // 3. Outlook Web / desktop with divRplyFwdMsg.
  //    The original email body sits AFTER divRplyFwdMsg as a sibling, so snipFrom
  //    removes the header div and everything that follows it.
  if (!hasQuote) {
    const outlookDiv = div.querySelector("#divRplyFwdMsg, [id^='divRplyFwdMsg']");
    if (outlookDiv) {
      const prev = outlookDiv.previousElementSibling;
      if (prev && prev.tagName === "HR") prev.remove();
      snipFrom(outlookDiv);
    }
  }

  // 3b. Outlook / Word format — no <hr> element, no divRplyFwdMsg.
  //     The separator is a CSS border-top on a <div>; the quote header is a small
  //     element containing the Outlook From / Sent / To / Subject pattern.
  //     Find the first small element matching that pattern and snipFrom it, which
  //     also removes the original email content that follows as a sibling.
  if (!hasQuote) {
    const elements = Array.from(div.querySelectorAll("p, div"));
    for (const el of elements) {
      // Skip large containers — the header element has very few descendants
      if (el.querySelectorAll("p, div").length > 4) continue;
      const text = el.textContent.replace(/\s+/g, " ").trim();
      if (/From:\s.+Sent:.+To:.+Subject:/i.test(text)) {
        snipFrom(el);
        break;
      }
    }
  }

  // 4. Yahoo Mail
  if (!hasQuote) {
    const yahoo = div.querySelector(".yahoo_quoted");
    if (yahoo) snip(yahoo);
  }

  // 5. Any <hr> — string-based split on serialised innerHTML so nesting depth
  //    doesn't matter. Covers Xneelo webmail, mobile clients, and plain-hr formats.
  if (!hasQuote) {
    const current = div.innerHTML;
    const hrIdx = current.search(/<hr[\s\/>]/i);
    if (hrIdx !== -1) {
      quoteHtml = current.slice(hrIdx);
      div.innerHTML = current.slice(0, hrIdx);
      hasQuote = true;
    }
  }

  return { body: div.innerHTML.trim(), hasQuote, quoteHtml };
}
