import { jsPDF } from 'jspdf';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const docsDir = resolve(root, 'docs');
const outputDir = resolve(docsDir, 'pdf');

const SOP_DOCS = [
  {
    input: resolve(docsDir, 'HOTEL_POS_SOP.md'),
    output: resolve(outputDir, 'HOTEL_POS_SOP.pdf'),
    title: 'Hotel POS SOP',
  },
  {
    input: resolve(docsDir, 'HOTEL_POS_WAITER_QUICK_REFERENCE.md'),
    output: resolve(outputDir, 'HOTEL_POS_WAITER_QUICK_REFERENCE.pdf'),
    title: 'Hotel POS Waiter Quick Reference',
  },
  {
    input: resolve(docsDir, 'HOTEL_POS_MANAGER_QUICK_REFERENCE.md'),
    output: resolve(outputDir, 'HOTEL_POS_MANAGER_QUICK_REFERENCE.pdf'),
    title: 'Hotel POS Manager Quick Reference',
  },
  {
    input: resolve(docsDir, 'HOTEL_POS_TRAINING_PACK.md'),
    output: resolve(outputDir, 'HOTEL_POS_TRAINING_PACK.pdf'),
    title: 'Hotel POS Training Pack',
  },
  {
    input: resolve(docsDir, 'SCHOOL_BUSINESS_SOP.md'),
    output: resolve(outputDir, 'SCHOOL_BUSINESS_SOP.pdf'),
    title: 'School Business SOP',
  },
  {
    input: resolve(docsDir, 'SCHOOL_STAFF_QUICK_REFERENCE.md'),
    output: resolve(outputDir, 'SCHOOL_STAFF_QUICK_REFERENCE.pdf'),
    title: 'School Staff Quick Reference',
  },
  {
    input: resolve(docsDir, 'SCHOOL_MANAGER_QUICK_REFERENCE.md'),
    output: resolve(outputDir, 'SCHOOL_MANAGER_QUICK_REFERENCE.pdf'),
    title: 'School Manager Quick Reference',
  },
  {
    input: resolve(docsDir, 'SCHOOL_TRAINING_PACK.md'),
    output: resolve(outputDir, 'SCHOOL_TRAINING_PACK.pdf'),
    title: 'School Training Pack',
  },
];

function normalizeMarkdown(markdown) {
  return markdown
    .replace(/\r/g, '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '- ')
    .trim();
}

function writePdf({ input, output, title }) {
  const raw = readFileSync(input, 'utf8');
  const text = normalizeMarkdown(raw);

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const lineHeight = 14;
  const maxWidth = pageWidth - margin * 2;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(title, margin, margin);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const wrapped = doc.splitTextToSize(text, maxWidth);

  let y = margin + 24;
  for (const line of wrapped) {
    if (y > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
    doc.text(line, margin, y);
    y += lineHeight;
  }

  const pdfBytes = doc.output('arraybuffer');
  writeFileSync(output, Buffer.from(pdfBytes));
  console.log(`Created: ${output}`);
}

mkdirSync(outputDir, { recursive: true });
SOP_DOCS.forEach(writePdf);
