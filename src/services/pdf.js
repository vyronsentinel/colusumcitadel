import PDFDocument from 'pdfkit';

const peso = (n) => 'PHP ' + (Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Decode a base64 data URL (PNG/JPG) into a Buffer for pdfkit. SVG is not supported by pdfkit images.
function logoBuffer(logo) {
  if (!logo || typeof logo !== 'string') return null;
  const m = logo.match(/^data:image\/(png|jpe?g);base64,(.+)$/i);
  if (!m) return null;
  try { return Buffer.from(m[2], 'base64'); } catch { return null; }
}

/**
 * Render a payslip PDF to a Buffer, branded with the company's logo + color.
 * @returns {Promise<Buffer>}
 */
export function renderPayslipPdf({ company, employee, slip, period }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const brand = (company.brand_color && /^#[0-9a-fA-F]{6}$/.test(company.brand_color)) ? company.brand_color : '#27406e';
    const buf = logoBuffer(company.logo);
    let textX = 48;
    if (buf) {
      try { doc.image(buf, 48, 48, { fit: [54, 54] }); textX = 112; } catch { /* ignore invalid image */ }
    }

    // Header
    doc.fillColor('#111').fontSize(18).font('Helvetica-Bold').text(company.name, textX, 50, { width: 260 });
    doc.fontSize(9).font('Helvetica').fillColor('#666')
      .text(`TIN ${company.tin || ''}${company.address ? '  ·  ' + company.address : ''}`, textX, doc.y, { width: 260 });
    doc.fillColor(brand).fontSize(12).font('Helvetica-Bold')
      .text(`PAYSLIP — ${slip.slip_no}`, 320, 50, { width: 227, align: 'right' });
    doc.fontSize(9).font('Helvetica').fillColor('#666').text(period, 320, doc.y, { width: 227, align: 'right' });

    const ruleY = 114;
    doc.moveTo(48, ruleY).lineTo(547, ruleY).strokeColor(brand).lineWidth(1.5).stroke();
    doc.lineWidth(1);

    // Employee info
    doc.fillColor('#111').fontSize(10).font('Helvetica').text(`Employee: ${employee.first_name} ${employee.last_name}   (${employee.emp_no})`, 48, ruleY + 12);
    doc.text(`Position: ${employee.position || '—'}    Department: ${employee.department || '—'}`);
    doc.moveDown(0.8);

    const e = slip.earnings; const d = slip.deductions;
    const colY = doc.y;
    const line = (label, val, y) => {
      doc.font('Helvetica').fontSize(9).fillColor('#111').text(label, 48, y, { width: 200 });
      doc.text(peso(val), 200, y, { width: 60, align: 'right' });
    };
    doc.font('Helvetica-Bold').fontSize(10).fillColor(brand).text('Earnings', 48, colY);
    doc.fillColor('#111');
    let y = colY + 16;
    const eItems = [['Basic pay', e.basicPay], ['Overtime', e.overtime], ['Night diff', e.nightDiff], ['Reg holiday', e.regHolidayPay], ['Special holiday', e.specHolidayPay], ['Leave pay', e.leavePay], ['Commission', e.commission], ['Bonus', e.bonus], ['Incentive', e.incentive], ['Allowance', e.allowance]];
    for (const [l, v] of eItems) { if (v) { line(l, v, y); y += 14; } }
    doc.font('Helvetica-Bold'); line('GROSS PAY', slip.gross_pay, y + 4);

    // Deductions column (right)
    const dLine = (label, val, yy) => {
      doc.font('Helvetica').fontSize(9).fillColor('#111').text(label, 310, yy, { width: 180 });
      doc.text(peso(val), 487, yy, { width: 60, align: 'right' });
    };
    doc.font('Helvetica-Bold').fontSize(10).fillColor(brand).text('Deductions', 310, colY);
    doc.fillColor('#111');
    let y2 = colY + 16;
    const dItems = [['SSS', d.sss], ['PhilHealth', d.philhealth], ['Pag-IBIG', d.pagibig], ['Withholding tax', d.withholdingTax], ['Tardiness', d.tardiness], ['Loans', d.loans], ['Salary advance', d.salaryAdvance], ['Company ded.', d.companyDeduction]];
    for (const [l, v] of dItems) { if (v) { dLine(l, v, y2); y2 += 14; } }
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#111').text('TOTAL DEDUCTIONS', 310, y2 + 4, { width: 180 });
    doc.text(peso(slip.total_ded), 487, y2 + 4, { width: 60, align: 'right' });

    // Net pay box (brand colored)
    const netY = Math.max(y, y2) + 40;
    doc.save();
    doc.rect(48, netY, 499, 36).fill(brand);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(14).text('NET PAY', 60, netY + 10);
    doc.text(peso(slip.net_pay), 350, netY + 9, { width: 185, align: 'right' });
    doc.restore();

    doc.fillColor('#999').font('Helvetica').fontSize(8)
      .text('System-generated payslip. Sensitive fields stored encrypted at rest.', 48, netY + 56, { align: 'center', width: 499 });

    doc.end();
  });
}
