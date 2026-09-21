import PDFDocument from 'pdfkit';
import { FieldType } from '@prisma/client';
import { FullApplication, STATUS_LABELS, valuesOf } from './applications';

/** Renders a downloadable receipt / dossier for a single application. */
export function renderApplicationPdf(application: FullApplication): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const values = valuesOf(application);

    doc.fontSize(20).text(application.grant.title, { continued: false });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#555').text(`Application #${application.id} — ${STATUS_LABELS[application.status]}`);
    doc.text(`Applicant: ${application.user.name} <${application.user.email}>`);
    if (application.user.organization) doc.text(`Organization: ${application.user.organization}`);
    doc.text(
      application.submittedAt
        ? `Submitted: ${application.submittedAt.toUTCString()}`
        : `Last saved: ${application.updatedAt.toUTCString()}`,
    );
    doc.moveDown(1).fillColor('#000');

    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ddd').stroke();
    doc.moveDown(1);

    for (const requirement of application.grant.requirements) {
      const value = values[requirement.key];
      let rendered: string;

      if (requirement.fieldType === FieldType.file) {
        const row = application.responses.find((r) => r.requirementId === requirement.id);
        rendered = row?.file ? `${row.file.filename} (${Math.round(Number(row.file.sizeBytes) / 1024)} kB)` : '—';
      } else if (requirement.fieldType === FieldType.checkbox) {
        rendered = value === true ? 'Yes' : 'No';
      } else if (Array.isArray(value)) {
        rendered = value.length > 0 ? value.join(', ') : '—';
      } else {
        rendered = value === null || value === undefined || value === '' ? '—' : String(value);
      }

      doc.fontSize(11).fillColor('#111').text(requirement.label, { continued: false });
      doc.fontSize(11).fillColor('#333').text(rendered, { indent: 12 });
      doc.moveDown(0.6);
    }

    if (application.reviews.length > 0) {
      doc.addPage();
      doc.fontSize(16).fillColor('#000').text('Reviews');
      doc.moveDown(0.5);
      for (const review of application.reviews) {
        doc.fontSize(11).fillColor('#111').text(`${review.reviewer.name}${review.score !== null ? ` — score ${review.score}` : ''}`);
        if (review.recommendation) doc.fontSize(10).fillColor('#555').text(`Recommendation: ${review.recommendation}`, { indent: 12 });
        if (review.notes) doc.fontSize(10).fillColor('#333').text(review.notes, { indent: 12 });
        doc.moveDown(0.6);
      }
    }

    if (application.decisionNote) {
      doc.moveDown(1);
      doc.fontSize(12).fillColor('#111').text('Decision note');
      doc.fontSize(10).fillColor('#333').text(application.decisionNote, { indent: 12 });
    }

    doc.end();
  });
}
