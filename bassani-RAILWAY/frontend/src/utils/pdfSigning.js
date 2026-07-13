// Shared PDF field detection, prefill mapping, and signing utilities.
// Used by both the admin test signing flow (DocumentTemplates) and the
// customer self-service signing flow (PublicRegister).

export const DOC_CONFIGS = {
  nda: {
    hasBassaniSig: true,
    sections: [
      { title: "Company details", fields: [
        { name: "company_name_1",        label: "Company Name",                   testDefault: "Test Company (Pty) Ltd" },
        { name: "company_address",       label: "Company Address",                testDefault: "123 Main Road, Johannesburg, Gauteng, 2000" },
        { name: "company_reg_number",    label: "Registration Number",            testDefault: "2024/123456/07" },
      ]},
      { title: "Contact details", fields: [
        { name: "customer_company_name", label: "Company Name (signature block)", testDefault: "Test Company (Pty) Ltd" },
        { name: "customer_name",         label: "Full Name",                      testDefault: "Test Customer" },
        { name: "customer_position",     label: "Position / Title",               testDefault: "Director" },
        { name: "customer_location",     label: "City / Location of Signing",     testDefault: "Johannesburg" },
      ]},
    ],
    isAutoFill: (name) => name.startsWith("bassani_") || name.startsWith("effective_date"),
    getAutoFillValue: (name, profile) => {
      if (name === "bassani_name")                 return profile?.name  || "";
      if (name.toLowerCase().includes("position")) return profile?.title || "";
      return new Date().toLocaleDateString("en-ZA", { day: "2-digit", month: "long", year: "numeric" });
    },
    bassaniTextFields: [
      { name: "bassani_name",     description: "Full name of Bassani signing authority" },
      { name: "effective_date_*", description: "Effective date of the agreement (set to today)" },
    ],
  },
  store_onboarding_agreement: {
    hasBassaniSig: true,
    sections: [
      { title: "Business details", fields: [
        { name: "registered_business_name",    label: "Registered Business Name",    testDefault: "Test Company (Pty) Ltd" },
        { name: "tradingin_name",              label: "Trading Name",                testDefault: "Test Trading Name" },
        { name: "company_reg_number",          label: "Registration Number",         testDefault: "2024/123456/07" },
        { name: "vat_reg_number",              label: "VAT Number",                  testDefault: "4560123456" },
        { name: "registered_business_address", label: "Registered Business Address", testDefault: "123 Main Road, Sandton, Johannesburg, 2196" },
        { name: "collection_point_address",    label: "Collection Point Address",    testDefault: "123 Main Road, Sandton, Johannesburg, 2196" },
      ]},
      { title: "Signatory details", fields: [
        { name: "signatory_full_name",    label: "Full Name",        testDefault: "Test Customer" },
        { name: "signatory_id_number",    label: "ID Number",        testDefault: "9001010000087" },
        { name: "signatory_title",        label: "Title / Position", testDefault: "Director" },
        { name: "primary_contact_number", label: "Phone Number",     testDefault: "+27 11 000 0000" },
        { name: "primary_email_address",  label: "Email Address",    testDefault: "test@example.com" },
      ]},
      { title: "Signature block", fields: [
        { name: "store_signed_at",    label: "City / Location of Signing",  testDefault: "Johannesburg" },
        { name: "store_full_name",    label: "Full Name (signature block)", testDefault: "Test Customer" },
        { name: "store_capacity",     label: "Capacity / Role",             testDefault: "Director" },
        { name: "store_witness_name", label: "Witness Name",                testDefault: "Test Witness" },
      ]},
      { title: "Other", fields: [
        { name: "assigned_reseller_code", label: "Reseller Code (if applicable)", testDefault: "" },
      ]},
    ],
    isAutoFill: (name) => name.startsWith("bassani_") || name === "store_date_es_:signer:date",
    getAutoFillValue: (name, profile) => {
      if (name === "bassani_name")     return profile?.name  || "";
      if (name === "bassani_position") return profile?.title || "";
      if (name === "bassani_witness")  return "";
      return new Date().toLocaleDateString("en-ZA", { day: "2-digit", month: "long", year: "numeric" });
    },
    bassaniTextFields: [
      { name: "bassani_name",               description: "Full name of Bassani signing authority" },
      { name: "bassani_position",           description: "Title / position of Bassani signing authority" },
      { name: "bassani_witness",            description: "Left blank (witness signs by hand)" },
      { name: "store_date_es_:signer:date", description: "Date of signing (set to today)" },
    ],
  },
  customer_information_form: {
    hasBassaniSig: false,
    sections: [
      { title: "Business details", fields: [
        { name: "business_name",      label: "Trading / Business Name",  testDefault: "Test Trading Name" },
        { name: "company_name",       label: "Registered Company Name",  testDefault: "Test Company (Pty) Ltd" },
        { name: "company_reg_number", label: "Registration Number",      testDefault: "2024/123456/07" },
        { name: "vat_number",         label: "VAT Number",               testDefault: "4560123456" },
      ]},
      { title: "Contact details", fields: [
        { name: "full_name",     label: "Full Name",         testDefault: "Test Customer" },
        { name: "position",      label: "Position / Title",  testDefault: "Director" },
        { name: "phone_number",  label: "Phone Number",      testDefault: "+27 11 000 0000" },
        { name: "email_address", label: "Email Address",     testDefault: "test@example.com" },
        { name: "alt_phone",     label: "Alternative Phone", testDefault: "" },
      ]},
      { title: "Business address", fields: [
        { name: "street_address", label: "Street Address", testDefault: "123 Main Road" },
        { name: "suburb",         label: "Suburb",         testDefault: "Sandton" },
        { name: "city",           label: "City",           testDefault: "Johannesburg" },
        { name: "province",       label: "Province",       testDefault: "Gauteng" },
        { name: "postal_code",    label: "Postal Code",    testDefault: "2196" },
      ]},
    ],
    isAutoFill: (name) => name === "date_day" || name === "date_month" || name === "date_year",
    getAutoFillValue: (name) => {
      const now = new Date();
      if (name === "date_day")   return String(now.getDate()).padStart(2, "0");
      if (name === "date_month") return now.toLocaleString("en-ZA", { month: "long" });
      if (name === "date_year")  return String(now.getFullYear());
      return "";
    },
  },
};

// Maps wizard form state to PDF AcroForm field names.
export function buildPrefill(docType, form) {
  const addr = [form.street, form.suburb, form.city, form.province, form.postal_code]
    .filter(Boolean).join(", ");
  if (docType === "nda") return {
    company_name_1:        form.company_name,
    company_address:       addr,
    company_reg_number:    form.registration_number,
    customer_company_name: form.company_name,
    customer_name:         form.contact_name,
    customer_position:     form.contact_position,
    customer_location:     form.city,
  };
  if (docType === "customer_information_form") return {
    business_name:      form.trading_name || form.company_name,
    company_name:       form.company_name,
    company_reg_number: form.registration_number,
    vat_number:         form.vat_number,
    full_name:          form.contact_name,
    position:           form.contact_position,
    phone_number:       form.contact_phone,
    email_address:      form.contact_email,
    alt_phone:          form.contact_alt_phone,
    street_address:     form.street,
    suburb:             form.suburb,
    city:               form.city,
    province:           form.province,
    postal_code:        form.postal_code,
  };
  if (docType === "store_onboarding_agreement") return {
    registered_business_name:    form.company_name,
    tradingin_name:              form.trading_name,
    company_reg_number:          form.registration_number,
    vat_reg_number:              form.vat_number,
    registered_business_address: addr,
    collection_point_address:    addr,
    signatory_full_name:         form.contact_name,
    signatory_id_number:         form.signatory_id_number,
    signatory_title:             form.contact_position,
    primary_contact_number:      form.contact_phone,
    primary_email_address:       form.contact_email,
    store_signed_at:             form.city,
    store_full_name:             form.contact_name,
    store_capacity:              form.contact_position,
  };
  return {};
}

export async function detectFields(pdfBytes) {
  const { PDFDocument } = await import("pdf-lib");
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const form   = pdfDoc.getForm();
  const pages  = pdfDoc.getPages();

  // Map page object number to page index via each page's own ref.
  // (PDFArray.get() dereferences to PDFDict not PDFRef, so objectNumber
  // is always undefined on the annotation array path.)
  const pageRefToIdx = new Map();
  pages.forEach((page, idx) => pageRefToIdx.set(page.ref.objectNumber, idx));

  return form.getFields().map(field => {
    const name = field.getName();
    // constructor.name is minified in production — use name-based detection only.
    const type = name.toLowerCase().includes("signature") ? "Signature" : "Text";
    const widgets = field.acroField.getWidgets();
    const widget  = widgets[0];
    const pageRef = widget?.P?.();
    const pageIdx = pageRef?.objectNumber != null
      ? (pageRefToIdx.get(pageRef.objectNumber) ?? 0)
      : 0;
    const rect = widget?.getRectangle?.() || null;
    return { name, type, page: pageIdx + 1, rect };
  });
}

/**
 * Fill and flatten a PDF with text values and signature images.
 *
 * @param {Uint8Array} pdfBytes
 * @param {Object} options
 * @param {Object}         options.textValues         - { [fieldName]: string }
 * @param {Object|null}    options.signingProfile     - { name, title } for Bassani auto-fill text
 * @param {string|null}    options.mikeFieldName      - AcroForm field name for Bassani's sig, or null
 * @param {ArrayBuffer|null} options.mikeImageBytes   - PNG bytes for Bassani's sig, or null
 * @param {string|null}    options.customerSigDataUrl - PNG data URL for customer sig, or null
 * @param {Object|null}    options.config             - DOC_CONFIGS entry
 * @param {boolean}        options.addWatermark       - Stamp "TEST DOCUMENT" on page 1
 */
export async function generateSignedPdf(pdfBytes, {
  textValues = {},
  signingProfile = null,
  mikeFieldName = null,
  mikeImageBytes = null,
  customerSigDataUrl = null,
  config = null,
  addWatermark = false,
}) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdfDoc   = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const form     = pdfDoc.getForm();
  const pages    = pdfDoc.getPages();
  const fontReg  = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageRefToIdx = new Map();
  pages.forEach((page, idx) => pageRefToIdx.set(page.ref.objectNumber, idx));

  let mikeImage = null;
  if (mikeFieldName && mikeImageBytes) {
    try { mikeImage = await pdfDoc.embedPng(mikeImageBytes); } catch {}
  }

  let customerImage = null;
  if (customerSigDataUrl) {
    try {
      const b64   = customerSigDataUrl.replace(/^data:image\/png;base64,/, "");
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      customerImage = await pdfDoc.embedPng(bytes);
    } catch {}
  }

  for (const field of form.getFields()) {
    const name       = field.getName();
    const isSigField = name.toLowerCase().includes("signature");

    if (!isSigField) {
      let val = "";
      if (config?.isAutoFill?.(name)) {
        val = config.getAutoFillValue(name, signingProfile) || "";
      } else {
        val = textValues[name] ?? "";
      }
      try { field.setText(val); field.enableReadOnly(); } catch {}
      continue;
    }

    const isMike         = mikeFieldName !== null && name === mikeFieldName;
    const image          = isMike ? mikeImage : customerImage;
    const isBassaniBlank = isMike && !mikeImage;

    for (const widget of field.acroField.getWidgets()) {
      const rect    = widget.getRectangle?.();
      if (!rect) continue;
      const pageRef = widget.P?.();
      const pageIdx = pageRef?.objectNumber != null ? (pageRefToIdx.get(pageRef.objectNumber) ?? 0) : 0;
      const page    = pages[pageIdx];
      if (!page) continue;

      if (image) {
        const pad    = 4;
        const fieldW = rect.width  - pad * 2;
        const fieldH = rect.height - pad * 2;
        const scale  = Math.min(fieldW / image.width, fieldH / image.height);
        const drawW  = image.width  * scale;
        const drawH  = image.height * scale;
        page.drawImage(image, {
          x: rect.x + pad + (fieldW - drawW) / 2,
          y: rect.y + pad + (fieldH - drawH) / 2,
          width: drawW, height: drawH,
        });
      } else if (isBassaniBlank && addWatermark) {
        // Admin test only: blue placeholder for unconfigured Bassani sig
        const label = "[ CEO Signature - not configured ]";
        page.drawRectangle({ x: rect.x, y: rect.y, width: rect.width, height: rect.height,
          color: rgb(0.88, 0.94, 1), borderColor: rgb(0.2, 0.4, 0.8), borderWidth: 1.5, opacity: 0.8 });
        const sz = Math.min(10, rect.height * 0.35);
        page.drawText(label, { x: rect.x + 4, y: rect.y + (rect.height - sz) / 2,
          size: sz, font: fontBold, color: rgb(0.2, 0.4, 0.8), maxWidth: rect.width - 8 });
      } else if (!isBassaniBlank) {
        // No customer sig drawn — placeholder
        page.drawRectangle({ x: rect.x, y: rect.y, width: rect.width, height: rect.height,
          color: rgb(0.95, 0.95, 0.95), borderColor: rgb(0.5, 0.5, 0.5), borderWidth: 1.5, opacity: 0.8 });
        const sz = Math.min(10, rect.height * 0.35);
        page.drawText("[ No signature drawn ]", { x: rect.x + 4, y: rect.y + (rect.height - sz) / 2,
          size: sz, font: fontBold, color: rgb(0.5, 0.5, 0.5), maxWidth: rect.width - 8 });
      }
      // isBassaniBlank && !addWatermark: customer flow — leave Bassani's block blank
    }
  }

  try { form.flatten(); } catch {}

  if (addWatermark && pages.length > 0) {
    pages[0].drawText("TEST DOCUMENT - NOT FOR USE", {
      x: 40, y: pages[0].getHeight() - 30,
      size: 9, font: fontReg, color: rgb(0.8, 0.2, 0.2), opacity: 0.7,
    });
  }

  return pdfDoc.save();
}

/**
 * Overlay the Bassani signing authority signature onto an already-flattened
 * customer-signed PDF.  The Bassani signature field coordinates are detected
 * from the blank template (which still has AcroForm fields) and then drawn
 * at those exact coordinates on the flat customer PDF.
 *
 * @param {Uint8Array}   customerPdfBytes     - Flattened, customer-signed PDF
 * @param {Uint8Array}   blankTemplateBytes   - Original template (has AcroForm fields)
 * @param {string}       docType              - Key into DOC_CONFIGS
 * @param {Uint8Array}   sigBytes             - PNG bytes of the admin signature
 * @returns {Promise<Uint8Array>}
 */
export async function countersignPdf(customerPdfBytes, blankTemplateBytes, docType, sigBytes) {
  const { PDFDocument } = await import("pdf-lib");
  const config = DOC_CONFIGS[docType];
  if (!config?.hasBassaniSig) return customerPdfBytes;

  // Locate Bassani's signature field in the blank template
  const fields = await detectFields(blankTemplateBytes);
  const bassaniField = fields.find(
    f => f.type === "Signature" && config.isAutoFill(f.name)
  );
  if (!bassaniField?.rect) return customerPdfBytes;

  const pdfDoc = await PDFDocument.load(customerPdfBytes, { ignoreEncryption: true });
  const pages  = pdfDoc.getPages();
  const page   = pages[bassaniField.page - 1]; // detectFields returns 1-indexed page
  if (!page) return customerPdfBytes;

  const sigImage = await pdfDoc.embedPng(sigBytes);
  const { width: imgW, height: imgH } = sigImage.scale(1);

  const rect   = bassaniField.rect;
  const pad    = 4;
  const fieldW = rect.width  - pad * 2;
  const fieldH = rect.height - pad * 2;
  const scale  = Math.min(fieldW / imgW, fieldH / imgH);
  const drawW  = imgW * scale;
  const drawH  = imgH * scale;

  page.drawImage(sigImage, {
    x:      rect.x + pad + (fieldW - drawW) / 2,
    y:      rect.y + pad + (fieldH - drawH) / 2,
    width:  drawW,
    height: drawH,
  });

  return pdfDoc.save();
}
