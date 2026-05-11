export function buildPlainTextTitleBody(
  title: string,
  formNote: string | undefined,
  body: string,
): string {
  const lines: string[] = [];
  const t = title.trim();
  if (t) lines.push(t, "");
  const f = formNote?.trim();
  if (f) lines.push(`(${f})`, "");
  lines.push(body);
  return lines.join("\n").replace(/\n+$/, "") + (lines.length ? "\n" : "");
}

export function buildMarkdownPoem(
  title: string,
  formNote: string | undefined,
  body: string,
): string {
  const t = title.trim();
  const f = formNote?.trim();
  const parts: string[] = [];
  if (t) parts.push(`# ${t}`, "");
  if (f) parts.push(`*${f}*`, "");
  if (body.trim()) {
    for (const line of body.split("\n")) {
      parts.push(line.length ? line : "");
    }
  }
  return parts.join("\n").replace(/\n+$/, "") + "\n";
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function todayPrefix(d = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function timestampStamp(d = new Date()): string {
  return `${todayPrefix(d)}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function firstNonEmptyLine(body: string): string {
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (t) return t;
  }
  return "";
}

function slugBase(title: string, body: string): string {
  const fromTitle = slugify(title);
  if (fromTitle) return fromTitle;
  const fromBody = slugify(firstNonEmptyLine(body));
  if (fromBody) return fromBody;
  return timestampStamp();
}

export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  triggerBlobDownload(filename, blob);
}

function triggerBlobDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportFilename(
  title: string,
  ext: "txt" | "md" | "docx" | "pdf" | "html" | "png",
  body = "",
): string {
  return `${todayPrefix()}-${slugBase(title, body)}.${ext}`;
}

export async function buildPoemDocxBlob(
  title: string,
  formNote: string | undefined,
  body: string,
): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import(
    "docx"
  );
  const children: InstanceType<typeof Paragraph>[] = [];
  const t = title.trim();
  if (t) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.TITLE,
        children: [new TextRun(t)],
      }),
    );
  }
  const f = formNote?.trim();
  if (f) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: f, italics: true })],
      }),
    );
  }
  if (t || f) {
    children.push(new Paragraph({ text: "" }));
  }
  for (const line of body.split("\n")) {
    children.push(new Paragraph({ children: [new TextRun(line)] }));
  }
  const doc = new Document({
    sections: [{ properties: {}, children }],
  });
  return Packer.toBlob(doc);
}

export async function downloadDocxFile(
  filename: string,
  title: string,
  formNote: string | undefined,
  body: string,
): Promise<void> {
  const blob = await buildPoemDocxBlob(title, formNote, body);
  triggerBlobDownload(filename, blob);
}

export async function buildPoemPdfBlob(
  title: string,
  formNote: string | undefined,
  body: string,
): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 72;
  const marginTop = 72;
  const marginBottom = 72;
  const maxWidth = pageWidth - marginX * 2;
  let y = marginTop;

  const t = title.trim();
  const f = formNote?.trim();

  doc.setFont("times", "normal");

  if (t) {
    doc.setFontSize(22);
    doc.setFont("times", "bold");
    const wrapped = doc.splitTextToSize(t, maxWidth);
    doc.text(wrapped, marginX, y);
    y += wrapped.length * 26;
    doc.setFont("times", "normal");
  }

  if (f) {
    doc.setFontSize(12);
    doc.setFont("times", "italic");
    const wrapped = doc.splitTextToSize(f, maxWidth);
    doc.text(wrapped, marginX, y);
    y += wrapped.length * 16;
    doc.setFont("times", "normal");
  }

  if (t || f) y += 14;

  doc.setFontSize(13);
  const lineHeight = 20;

  for (const rawLine of body.split("\n")) {
    const wrapped = rawLine.length
      ? doc.splitTextToSize(rawLine, maxWidth)
      : [""];
    for (const piece of wrapped) {
      if (y + lineHeight > pageHeight - marginBottom) {
        doc.addPage();
        y = marginTop;
      }
      doc.text(piece, marginX, y);
      y += lineHeight;
    }
  }

  return doc.output("blob");
}

export async function downloadPdfFile(
  filename: string,
  title: string,
  formNote: string | undefined,
  body: string,
): Promise<void> {
  const blob = await buildPoemPdfBlob(title, formNote, body);
  triggerBlobDownload(filename, blob);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildPoemHtml(
  title: string,
  formNote: string | undefined,
  body: string,
): string {
  const t = title.trim();
  const f = formNote?.trim();
  const docTitle = t || "Poem";
  const bodyHtml = body
    .split("\n")
    .map((line) => {
      if (!line.length) return "<p class=\"blank\">&nbsp;</p>";
      return `<p>${escapeHtml(line)}</p>`;
    })
    .join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(docTitle)}</title>
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
    line-height: 1.7;
    color: #1d201f;
    background: #f6f5ef;
    padding: 64px 24px;
  }
  main { max-width: 640px; margin: 0 auto; }
  h1 {
    font-size: 1.9rem;
    font-weight: 600;
    margin: 0 0 0.4em 0;
    letter-spacing: 0.01em;
  }
  .form-note {
    font-style: italic;
    color: #5b6360;
    margin: 0 0 1.6em 0;
  }
  p {
    margin: 0;
    font-size: 1.05rem;
    white-space: pre-wrap;
  }
  p.blank { min-height: 1em; }
  @media (prefers-color-scheme: dark) {
    body { background: #15181a; color: #e6e3d8; }
    .form-note { color: #a3a89e; }
  }
  @media print {
    body { background: #fff; color: #000; padding: 0; }
    main { max-width: none; }
  }
</style>
</head>
<body>
<main>
${t ? `<h1>${escapeHtml(t)}</h1>` : ""}
${f ? `<p class="form-note">${escapeHtml(f)}</p>` : ""}
${bodyHtml}
</main>
</body>
</html>
`;
}

export async function downloadHtmlFile(
  filename: string,
  title: string,
  formNote: string | undefined,
  body: string,
): Promise<void> {
  const html = buildPoemHtml(title, formNote, body);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  triggerBlobDownload(filename, blob);
}

export async function buildPoemPngBlob(
  title: string,
  formNote: string | undefined,
  body: string,
): Promise<Blob> {
  const { toBlob } = await import("html-to-image");
  const node = document.createElement("div");
  node.style.position = "fixed";
  node.style.left = "-99999px";
  node.style.top = "0";
  node.style.width = "720px";
  node.style.padding = "72px";
  node.style.background = "#f6f5ef";
  node.style.color = "#1d201f";
  node.style.fontFamily =
    '"Iowan Old Style", "Palatino Linotype", Georgia, serif';
  node.style.lineHeight = "1.7";
  node.style.boxSizing = "border-box";

  const t = title.trim();
  const f = formNote?.trim();
  const parts: string[] = [];
  if (t) {
    parts.push(
      `<h1 style="font-size:28px;font-weight:600;margin:0 0 12px;letter-spacing:0.01em;">${escapeHtml(
        t,
      )}</h1>`,
    );
  }
  if (f) {
    parts.push(
      `<div style="font-style:italic;color:#5b6360;margin:0 0 28px;">${escapeHtml(
        f,
      )}</div>`,
    );
  }
  const bodyHtml = body
    .split("\n")
    .map((line) =>
      line.length
        ? `<div style="font-size:17px;">${escapeHtml(line)}</div>`
        : `<div style="font-size:17px;height:1.7em;">&nbsp;</div>`,
    )
    .join("");
  parts.push(`<div>${bodyHtml}</div>`);
  node.innerHTML = parts.join("");
  document.body.appendChild(node);
  try {
    const blob = await toBlob(node, {
      pixelRatio: 2,
      backgroundColor: "#f6f5ef",
    });
    if (!blob) throw new Error("Could not render image.");
    return blob;
  } finally {
    node.remove();
  }
}

export async function downloadPngFile(
  filename: string,
  title: string,
  formNote: string | undefined,
  body: string,
): Promise<void> {
  const blob = await buildPoemPngBlob(title, formNote, body);
  triggerBlobDownload(filename, blob);
}

export async function copyTextToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
