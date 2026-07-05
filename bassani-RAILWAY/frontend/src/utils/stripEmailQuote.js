/**
 * Strips the quoted reply chain from an inbound HTML email body.
 *
 * Email clients embed the previous message(s) in several different ways.
 * This function handles the most common patterns: Gmail, Apple Mail,
 * Thunderbird (blockquote), Outlook (divRplyFwdMsg + HR), and Yahoo Mail.
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

  const snip = (el) => {
    quoteHtml = el.outerHTML || "";
    el.remove();
    hasQuote = true;
  };

  // 1. Gmail: .gmail_attr attribution line + .gmail_quote block
  const gmailQuote = div.querySelector(".gmail_quote");
  if (gmailQuote) {
    const attr = div.querySelector(".gmail_attr");
    if (attr) attr.remove();
    snip(gmailQuote);
  }

  // 2. Standard blockquote — Apple Mail, Thunderbird, most RFC-compliant clients
  if (!hasQuote) {
    const bq = div.querySelector("blockquote");
    if (bq) {
      // Remove the "On [date], [name] wrote:" paragraph that precedes the quote
      const prev = bq.previousElementSibling;
      if (prev && /on\s.{4,160}\swrote:/i.test(prev.textContent)) {
        prev.remove();
      }
      snip(bq);
    }
  }

  // 3. Outlook reply/forward header div
  if (!hasQuote) {
    const outlookDiv = div.querySelector("#divRplyFwdMsg, [id^='divRplyFwdMsg']");
    if (outlookDiv) {
      const prev = outlookDiv.previousElementSibling;
      if (prev && prev.tagName === "HR") prev.remove();
      snip(outlookDiv);
    }
  }

  // 4. Yahoo Mail
  if (!hasQuote) {
    const yahoo = div.querySelector(".yahoo_quoted");
    if (yahoo) snip(yahoo);
  }

  // 5. Outlook plain-HR pattern: <hr> followed immediately by From:/Sent:/To: text
  if (!hasQuote) {
    const hr = div.querySelector("hr");
    if (hr) {
      const next = hr.nextElementSibling;
      if (next && /\b(from|sent|to|subject)\s*:/i.test(next.textContent)) {
        const snippets = [];
        let node = hr;
        while (node) {
          const nx = node.nextSibling;
          snippets.push(node.outerHTML || node.textContent || "");
          node.remove();
          node = nx;
        }
        quoteHtml = snippets.join("");
        hasQuote = true;
      }
    }
  }

  return { body: div.innerHTML.trim(), hasQuote, quoteHtml };
}
