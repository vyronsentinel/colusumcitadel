import PDFDocument from 'pdfkit';

const peso = (n) => 'PHP ' + (Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Render a payslip PDF to a Buffer.
 * @returns {Promise<Buffer>}
 */
export function renderPayslipPdf({ company, employee, slip, period }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.fontSize(18).font('Helvetica-Bold').text(company.name, { continued: false });
    doc.fontSize(9).font('Helvetica').fillColor('#666')
      .text(`TIN ${company.tin || ''}  ·  ${employee.branch || ''}`);
    doc.moveDown(0.3);
    doc.fillColor('#111').fontSize(12).font('Helvetica-Bold')
      .text(`PAYSLIP — ${slip.slip_no}`, { align: 'right' });
    doc.fontSize(9).font('Helvetica').fillColor('#666').text(period, { align: 'right' });
    doc.moveTo(48, doc.y + 4).lineTo(547, doc.y + 4).strokeColor('#111').stroke();
    doc.moveDown(1);

    // Employee info
    doc.fillColor('#111').fontSize(10).font('Helvetica');
    doc.text(`Employee: ${employee.first_name} ${employee.last_name}   (${employee.emp_no})`);
    doc.text(`Position: ${employee.position || '—'}    Department: ${employee.department || '—'}`);
    doc.moveDown(0.8);

    const e = slip.earnings; const d = slip.deductions;
    const colY = doc.y;
    const line = (label, val, y) => {
      doc.fontSize(9).fillColor('#111').text(label, 48, y, { width: 200 });
      doc.text(peso(val), 200, y, { width: 60, align: 'right' });
    };
    doc.font('Helvetica-Bold').fontSize(10).text('Earnings', 48, colY);
    let y = colY + 16;
    const eItems = [['Basic pay', e.basicPay], ['Overtime', e.overtime], ['Night diff', e.nightDiff], ['Reg holiday', e.regHolidayPay], ['Special holiday', e.specHolidayPay], ['Leave pay', e.leavePay], ['Commission', e.commission], ['Bonus', e.bonus], ['Incentive', e.incentive], ['Allowance', e.allowance]];
    doc.font('Helvetica');
    for (const [l, v] of eItems) { if (v) { line(l, v, y); y += 14; } }
    doc.font('Helvetica-Bold'); line('GROSS PAY', slip.gross_pay, y + 4);

    // Deductions column (right)
    const dLine = (label, val, yy) => {
      doc.font('Helvetica').fontSize(9).fillColor('#111').text(label, 310, yy, { width: 180 });
      doc.text(peso(val), 487, yy, { width: 60, align: 'right' });
    };
    doc.font('Helvetica-Bold').fontSize(10).text('Deductions', 310, colY);
    let y2 = colY + 16;
    const dItems = [['SSS', d.sss], ['PhilHealth', d.philhealth], ['Pag-IBIG', d.pagibig], ['Withholding tax', d.withholdingTax], ['Tardiness', d.tardiness], ['Loans', d.loans], ['Salary advance', d.salaryAdvance], ['Company ded.', d.companyDeduction]];
    for (const [l, v] of dItems) { if (v) { dLine(l, v, y2); y2 += 14; } }
    doc.font('Helvetica-Bold'); doc.fontSize(9).text('TOTAL DEDUCTIONS', 310, y2 + 4, { width: 180 });
    doc.text(peso(slip.total_ded), 487, y2 + 4, { width: 60, align: 'right' });

    // Net pay box
    const netY = Math.max(y, y2) + 40;
    doc.rect(48, netY, 499, 36).fillAndStroke('#f3f9fd', '#cde4f6');
    doc.fillColor('#1565c0').font('Helvetica-Bold').fontSize(14)
      .text('NET PAY', 60, netY + 10);
    doc.text(peso(slip.net_pay), 350, netY + 9, { width: 185, align: 'right' });

    doc.fillColor('#999').font('Helvetica').fontSize(8)
      .text('System-generated payslip. Sensitive fields stored encrypted at rest.', 48, netY + 56, { align: 'center', width: 499 });

    doc.end();
  });
}
