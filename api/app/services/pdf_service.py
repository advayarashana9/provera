import logging
import re
from io import BytesIO
from typing import List
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from app.models.research_report import AIResearchReport
from app.models.investment_memo import InvestmentMemo

logger = logging.getLogger(__name__)

def clean_and_linkify_text(text: str) -> str:
    # Escape standard XML characters
    text_escaped = text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    
    # Convert markdown bold **text** to <b>text</b>
    text_bold = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', text_escaped)
    
    # Replace [1], [2], etc. with ReportLab anchor tags linking internally
    def replace_cit(match):
        cit_id = match.group(1)
        return f'<a href="#citation-{cit_id}" color="#1d4ed8"><b>[{cit_id}]</b></a>'
        
    return re.sub(r'\[(\d+)\]', replace_cit, text_bold)


class PDFService:
    @staticmethod
    def generate_report_pdf(report: AIResearchReport, company_name: str, ticker: str, date_str: str) -> bytes:
        """
        Generate a professional institutional PDF research report from structured data.
        """
        buffer = BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=letter,
            rightMargin=54,
            leftMargin=54,
            topMargin=54,
            bottomMargin=54
        )
        
        styles = getSampleStyleSheet()
        
        title_style = ParagraphStyle(
            'ReportTitle',
            parent=styles['Heading1'],
            fontSize=22,
            leading=26,
            textColor=colors.HexColor('#18181b'), # Zinc 900
            spaceAfter=8
        )
        
        meta_style = ParagraphStyle(
            'ReportMeta',
            parent=styles['Normal'],
            fontSize=9,
            leading=13,
            textColor=colors.HexColor('#52525b'), # Zinc 600
            spaceAfter=20
        )
        
        h2_style = ParagraphStyle(
            'ReportH2',
            parent=styles['Heading2'],
            fontSize=13,
            leading=16,
            textColor=colors.HexColor('#18181b'),
            spaceBefore=14,
            spaceAfter=6,
            keepWithNext=True
        )
        
        body_style = ParagraphStyle(
            'ReportBody',
            parent=styles['BodyText'],
            fontSize=9.5,
            leading=13.5,
            textColor=colors.HexColor('#27272a'), # Zinc 800
            spaceAfter=8
        )
        
        story = []
        
        # Cover / Header
        story.append(Paragraph(f"{report.title}", title_style))
        story.append(Spacer(1, 4))
        
        # 1. Filing Metadata Table (3 columns, 2 rows)
        meta_table_style = ParagraphStyle(
            'MetaTableText',
            parent=styles['Normal'],
            fontSize=8,
            leading=10,
            textColor=colors.HexColor('#27272a')
        )
        meta_table_label_style = ParagraphStyle(
            'MetaTableLabel',
            parent=styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=8,
            leading=10,
            textColor=colors.HexColor('#18181b')
        )
        
        metadata_data = [
            [
                Paragraph("<b>Filing Type:</b>", meta_table_label_style), Paragraph(report.metadata.filing_type, meta_table_style),
                Paragraph("<b>Filing Date:</b>", meta_table_label_style), Paragraph(report.metadata.filing_date, meta_table_style),
                Paragraph("<b>Period End:</b>", meta_table_style), Paragraph(report.metadata.period_end, meta_table_style)
            ],
            [
                Paragraph("<b>Fiscal Period:</b>", meta_table_label_style), Paragraph(report.metadata.fiscal_quarter, meta_table_style),
                Paragraph("<b>CIK:</b>", meta_table_label_style), Paragraph(report.metadata.cik, meta_table_style),
                Paragraph("<b>Exchange:</b>", meta_table_label_style), Paragraph(report.metadata.exchange, meta_table_style)
            ]
        ]
        
        meta_table = Table(metadata_data, colWidths=[70, 98, 70, 98, 70, 98])
        meta_table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#f8fafc')),
            ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#e2e8f0')),
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
            ('TOPPADDING', (0,0), (-1,-1), 4),
            ('BOTTOMPADDING', (0,0), (-1,-1), 4),
            ('LEFTPADDING', (0,0), (-1,-1), 8),
            ('RIGHTPADDING', (0,0), (-1,-1), 8),
        ]))
        
        story.append(meta_table)
        story.append(Spacer(1, 10))
        
        # 2. Investment Snapshot Section Table
        story.append(Paragraph("Investment Snapshot", h2_style))
        story.append(Spacer(1, 4))
        
        assessment_color = '#71717a'
        assessment_val = report.investment_snapshot.overall_assessment.upper()
        if "POS" in assessment_val:
            assessment_color = '#15803d'
        elif "CAUT" in assessment_val or "NEG" in assessment_val:
            assessment_color = '#b91c1c'
            
        snapshot_label_style = ParagraphStyle(
            'SnapshotLabel',
            parent=styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=8,
            leading=10,
            textColor=colors.HexColor('#18181b')
        )
        snapshot_text_style = ParagraphStyle(
            'SnapshotText',
            parent=styles['Normal'],
            fontSize=8,
            leading=11,
            textColor=colors.HexColor('#27272a')
        )
        assessment_badge_style = ParagraphStyle(
            'AssessmentBadge',
            parent=styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=8.5,
            leading=10,
            textColor=colors.HexColor(assessment_color)
        )
        
        watch_bullets = "<br/>".join([f"• {item}" for item in report.investment_snapshot.metrics_to_watch_next_quarter])
        
        snapshot_data = [
            [Paragraph("Overall Assessment", snapshot_label_style), Paragraph(f"<b>{assessment_val}</b>", assessment_badge_style)],
            [Paragraph("Financial Health", snapshot_label_style), Paragraph(report.investment_snapshot.financial_health, snapshot_text_style)],
            [Paragraph("Liquidity", snapshot_label_style), Paragraph(report.investment_snapshot.liquidity, snapshot_text_style)],
            [Paragraph("Profitability", snapshot_label_style), Paragraph(report.investment_snapshot.profitability, snapshot_text_style)],
            [Paragraph("Leverage", snapshot_label_style), Paragraph(report.investment_snapshot.leverage, snapshot_text_style)],
            [Paragraph("Biggest Strength", snapshot_label_style), Paragraph(report.investment_snapshot.biggest_strength, snapshot_text_style)],
            [Paragraph("Biggest Risk", snapshot_label_style), Paragraph(report.investment_snapshot.biggest_risk, snapshot_text_style)],
            [Paragraph("Metrics to Watch Next Quarter", snapshot_label_style), Paragraph(watch_bullets, snapshot_text_style)],
        ]
        
        snapshot_table = Table(snapshot_data, colWidths=[120, 384])
        snapshot_table.setStyle(TableStyle([
            ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#e4e4e7')),
            ('BACKGROUND', (0,0), (0,-1), colors.HexColor('#f4f4f5')),
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
            ('TOPPADDING', (0,0), (-1,-1), 4),
            ('BOTTOMPADDING', (0,0), (-1,-1), 4),
            ('LEFTPADDING', (0,0), (-1,-1), 8),
            ('RIGHTPADDING', (0,0), (-1,-1), 8),
        ]))
        
        story.append(snapshot_table)
        story.append(Spacer(1, 10))
        
        sections = [
            ("Executive Summary", report.executive_summary),
            ("Business Overview", report.business_overview),
            ("Financial Highlights", report.financial_highlights),
            ("Balance Sheet Analysis", report.balance_sheet),
            ("Income Statement Analysis", report.income_statement),
            ("Cash Flow & Reserves", report.cash_flow),
            ("Profitability Metrics", report.profitability),
            ("Risk & Internal Controls", report.risks),
            ("Recent Changes & Filing Diff Summary", report.recent_changes),
            ("Management Discussion & Analysis Summary", report.management_discussion),
            ("Conclusion & Wrap-Up", report.conclusion),
        ]
        
        # Styles for key metrics cards
        metric_card_label_style = ParagraphStyle(
            'MetricCardLabel',
            parent=styles['Normal'],
            fontSize=7,
            leading=8.5,
            textColor=colors.HexColor('#71717a'),
            alignment=1
        )
        metric_card_val_style = ParagraphStyle(
            'MetricCardVal',
            parent=styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=10,
            leading=12,
            textColor=colors.HexColor('#18181b'),
            alignment=1
        )
        metric_card_change_style_up = ParagraphStyle(
            'MetricCardChangeUp',
            parent=styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=7,
            leading=8.5,
            textColor=colors.HexColor('#16a34a'),
            alignment=1
        )
        metric_card_change_style_down = ParagraphStyle(
            'MetricCardChangeDown',
            parent=styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=7,
            leading=8.5,
            textColor=colors.HexColor('#dc2626'),
            alignment=1
        )
        metric_card_change_style_stable = ParagraphStyle(
            'MetricCardChangeStable',
            parent=styles['Normal'],
            fontSize=7,
            leading=8.5,
            textColor=colors.HexColor('#71717a'),
            alignment=1
        )

        for sec_name, sec_obj in sections:
            story.append(Paragraph(sec_name, h2_style))
            content_text = sec_obj.content
            
            for p_text in content_text.split('\n\n'):
                if p_text.strip():
                    story.append(Paragraph(clean_and_linkify_text(p_text.strip()), body_style))
            story.append(Spacer(1, 4))
            
            # Directly below Executive Summary, inject the Key Metrics Grid
            if sec_name == "Executive Summary" and report.key_metrics:
                story.append(Spacer(1, 4))
                story.append(Paragraph("Key Metrics at a Glance", h2_style))
                story.append(Spacer(1, 4))
                
                cards = []
                for m in report.key_metrics:
                    ind_p = None
                    if m.change_percentage is not None:
                        is_growth_metric = m.key in ["revenue_growth", "net_income_growth", "cash_change"]
                        if is_growth_metric:
                            prefix_str = "+" if m.change_percentage > 0 else ""
                            ind_text = f"{prefix_str}{m.change_percentage * 100:.1f}% YoY"
                        else:
                            prefix_str = "+" if m.change_percentage > 0 else ""
                            ind_text = f"{prefix_str}{m.change_percentage:.2f} Abs"
                        
                        if m.status == "increased":
                            ind_p = Paragraph(f"▲ {ind_text}", metric_card_change_style_up)
                        elif m.status == "decreased":
                            ind_p = Paragraph(f"▼ {ind_text}", metric_card_change_style_down)
                        else:
                            ind_p = Paragraph(ind_text, metric_card_change_style_stable)
                    else:
                        ind_p = Paragraph("—", metric_card_change_style_stable)
                        
                    card_content = [
                        Spacer(1, 2),
                        Paragraph(m.label, metric_card_label_style),
                        Spacer(1, 1),
                        Paragraph(m.value, metric_card_val_style),
                        Spacer(1, 1),
                        ind_p,
                        Spacer(1, 2)
                    ]
                    cards.append(card_content)
                    
                grid_data = []
                col_count = 4
                for r_idx in range(2):
                    row_cells = []
                    for c_idx in range(col_count):
                        idx = r_idx * col_count + c_idx
                        if idx < len(cards):
                            row_cells.append(cards[idx])
                        else:
                            row_cells.append("")
                    grid_data.append(row_cells)
                    
                metrics_table = Table(grid_data, colWidths=[126, 126, 126, 126])
                metrics_table.setStyle(TableStyle([
                    ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#e2e8f0')),
                    ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#f8fafc')),
                    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
                    ('ALIGN', (0,0), (-1,-1), 'CENTER'),
                    ('TOPPADDING', (0,0), (-1,-1), 4),
                    ('BOTTOMPADDING', (0,0), (-1,-1), 4),
                ]))
                story.append(metrics_table)
                story.append(Spacer(1, 8))
            
        if report.citations:
            story.append(PageBreak())
            story.append(Paragraph("Sources & Citations Evidence", h2_style))
            story.append(Spacer(1, 8))
            
            table_body_style = ParagraphStyle(
                'TableBody',
                parent=styles['Normal'],
                fontSize=7.5,
                leading=9.5,
                textColor=colors.HexColor('#27272a')
            )
            table_val_style = ParagraphStyle(
                'TableVal',
                parent=table_body_style,
                alignment=2
            )
            table_center_style = ParagraphStyle(
                'TableCenter',
                parent=table_body_style,
                alignment=1
            )
            
            table_header_style = ParagraphStyle(
                'TableHeader',
                parent=styles['Normal'],
                fontSize=7.5,
                leading=9.5,
                fontName='Helvetica-Bold',
                textColor=colors.HexColor('#18181b')
            )
            table_header_val_style = ParagraphStyle(
                'TableHeaderVal',
                parent=table_header_style,
                alignment=2
            )
            table_header_center_style = ParagraphStyle(
                'TableHeaderCenter',
                parent=table_header_style,
                alignment=1
            )
            
            headers = ["Reference", "Concept", "Reported Value", "Unit", "Period", "Form", "Source"]
            header_styles = [
                table_header_center_style,
                table_header_style,
                table_header_val_style,
                table_header_center_style,
                table_header_center_style,
                table_header_center_style,
                table_header_center_style
            ]
            citation_data = [[Paragraph(h, header_styles[i]) for i, h in enumerate(headers)]]
            
            for c in report.citations:
                if c.unit == "%":
                    val_str = f"{c.value:.2f}"
                elif c.concept in {"current_ratio", "debt_to_equity"}:
                    val_str = f"{c.value:.2f}"
                elif isinstance(c.value, (int, float)) and not c.unit.lower() == "shares":
                    val_str = f"{c.value:,.2f}"
                else:
                    val_str = str(c.value)
                    
                source_html = "EDGAR"
                if c.source_url:
                    source_html = f'<a href="{c.source_url}" color="#1d4ed8"><u>SEC Link</u></a>'
                    
                citation_data.append([
                    Paragraph(f'<a name="citation-{c.id}"></a>[{c.id}]', table_center_style),
                    Paragraph(c.label or c.concept, table_body_style),
                    Paragraph(val_str, table_val_style),
                    Paragraph(c.unit or "—", table_center_style),
                    Paragraph(c.period_end, table_center_style),
                    Paragraph(c.form, table_center_style),
                    Paragraph(source_html, table_center_style)
                ])
            
            # [Reference, Concept, Reported Value, Unit, Period, Form, Source]
            # widths sum up to 504pt (printable area)
            t = Table(citation_data, colWidths=[45, 149, 75, 30, 65, 40, 100])
            t.setStyle(TableStyle([
                ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#f4f4f5')),
                ('BOTTOMPADDING', (0,0), (-1,0), 6),
                ('TOPPADDING', (0,0), (-1,0), 6),
                ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#e4e4e7')),
                ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
                ('BOTTOMPADDING', (0,1), (-1,-1), 4),
                ('TOPPADDING', (0,1), (-1,-1), 4),
            ]))
            story.append(t)
            
        doc.build(story)
        pdf_bytes = buffer.getvalue()
        buffer.close()
        return pdf_bytes

    @staticmethod
    def generate_memo_pdf(memo: InvestmentMemo, company_name: str, ticker: str, date_str: str) -> bytes:
        """
        Generate an institutional-quality PDF investment memo containing:
        - Cover Page
        - Table of Contents
        - Document body sections
        - Citation Appendix
        """
        buffer = BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=letter,
            rightMargin=54,
            leftMargin=54,
            topMargin=54,
            bottomMargin=54
        )
        
        styles = getSampleStyleSheet()
        
        cover_title_style = ParagraphStyle(
            'CoverTitle',
            parent=styles['Heading1'],
            fontSize=28,
            leading=34,
            textColor=colors.HexColor('#18181b'),
            alignment=1, # Centered
            spaceAfter=20
        )
        
        cover_subtitle_style = ParagraphStyle(
            'CoverSub',
            parent=styles['Normal'],
            fontSize=13,
            leading=18,
            textColor=colors.HexColor('#52525b'),
            alignment=1,
            spaceAfter=150
        )
        
        cover_meta_style = ParagraphStyle(
            'CoverMeta',
            parent=styles['Normal'],
            fontSize=9.5,
            leading=15,
            textColor=colors.HexColor('#27272a'),
            alignment=1
        )
        
        h1_style = ParagraphStyle(
            'MemoH1',
            parent=styles['Heading1'],
            fontSize=18,
            leading=22,
            textColor=colors.HexColor('#18181b'),
            spaceAfter=14
        )
        
        h2_style = ParagraphStyle(
            'MemoH2',
            parent=styles['Heading2'],
            fontSize=12,
            leading=15,
            textColor=colors.HexColor('#18181b'),
            spaceBefore=14,
            spaceAfter=6,
            keepWithNext=True
        )
        
        body_style = ParagraphStyle(
            'MemoBody',
            parent=styles['BodyText'],
            fontSize=9.5,
            leading=13.5,
            textColor=colors.HexColor('#27272a'),
            spaceAfter=8
        )
        
        toc_title_style = ParagraphStyle(
            'TOCTitle',
            parent=styles['Heading1'],
            fontSize=18,
            leading=22,
            textColor=colors.HexColor('#18181b'),
            spaceAfter=24
        )
        
        toc_item_style = ParagraphStyle(
            'TOCItem',
            parent=styles['Normal'],
            fontSize=11,
            leading=16,
            textColor=colors.HexColor('#27272a')
        )
        
        story = []
        
        # --- Page 1: COVER PAGE ---
        story.append(Spacer(1, 100))
        story.append(Paragraph("INSTITUTIONAL INVESTMENT MEMO", cover_title_style))
        story.append(Paragraph(f"Financial Verification & Analyst Synthesis for {company_name}", cover_subtitle_style))
        story.append(Spacer(1, 50))
        
        meta_html = f"""
        <b>Company:</b> {company_name}<br/>
        <b>Ticker Symbol:</b> {ticker}<br/>
        <b>Date Generated:</b> {date_str}<br/>
        <b>Source Data:</b> U.S. SEC EDGAR disclosures & calculated KPIs<br/>
        <b>Classification Status:</b> Verified factual reports<br/>
        """
        story.append(Paragraph(meta_html, cover_meta_style))
        story.append(PageBreak())
        
        # --- Page 2: TABLE OF CONTENTS ---
        story.append(Paragraph("Table of Contents", toc_title_style))
        story.append(Spacer(1, 10))
        
        toc_items = [
            ("I. Executive Summary", "Page 3"),
            ("II. Business Overview", "Page 3"),
            ("III. Financial Strength & Metrics", "Page 4"),
            ("IV. Growth Drivers & Trends", "Page 4"),
            ("V. Key Risks & Solvency", "Page 5"),
            ("VI. Filing Revisions & Diff Summary", "Page 5"),
            ("VII. Competitive Position & Benchmarks", "Page 6"),
            ("VIII. Overall Assessment & Evaluation", "Page 6"),
            ("IX. Key Financial Snapshot", "Page 7"),
            ("X. Sources & Citations Evidence", "Page 8"),
        ]
        
        toc_data = []
        for section_title, page_num in toc_items:
            toc_data.append([
                Paragraph(section_title, toc_item_style),
                Paragraph(". " * 35, ParagraphStyle('dots', parent=styles['Normal'], textColor=colors.HexColor('#d4d4d8'), alignment=1)),
                Paragraph(page_num, toc_item_style)
            ])
            
        t_toc = Table(toc_data, colWidths=[200, 240, 60])
        t_toc.setStyle(TableStyle([
            ('VALIGN', (0,0), (-1,-1), 'BOTTOM'),
            ('BOTTOMPADDING', (0,0), (-1,-1), 8),
        ]))
        story.append(t_toc)
        story.append(PageBreak())
        
        # --- Page 3+: CONTENT SECTIONS ---
        sections = [
            ("I. Executive Summary", memo.executive_summary),
            ("II. Business Overview", memo.business_overview),
            ("III. Financial Strength & Metrics", memo.financial_strength),
            ("IV. Growth Drivers & Trends", memo.growth_drivers),
            ("V. Key Risks & Solvency", memo.key_risks),
            ("VI. Filing Revisions & Diff Summary", memo.filing_changes),
            ("VII. Competitive Position & Benchmarks", memo.competitive_position),
            ("VIII. Overall Assessment & Evaluation", memo.overall_assessment),
        ]
        
        for idx, (sec_name, sec_obj) in enumerate(sections):
            # Page breaks to keep sections structured
            if idx > 0 and idx % 2 == 0:
                story.append(PageBreak())
                
            story.append(Paragraph(sec_name, h2_style))
            content_text = sec_obj.content
            
            for p_text in content_text.split('\n\n'):
                if p_text.strip():
                    story.append(Paragraph(p_text.strip(), body_style))
            story.append(Spacer(1, 6))
            
        # --- Page 7: KEY FINANCIAL SNAPSHOT PAGE ---
        story.append(PageBreak())
        story.append(Paragraph("IX. Key Financial Snapshot", h1_style))
        story.append(Spacer(1, 10))
        story.append(Paragraph(
            "Below is a structured overview of the verified financial metrics and ratios calculated deterministically "
            "from the primary SEC disclosures of the company.",
            body_style
        ))
        story.append(Spacer(1, 12))

        # Build table data
        snapshot_data = [["Ref", "Financial Metric / Ratio", "Reported Value", "Filing Source"]]
        
        for c in memo.citations:
            if c.concept in [
                "revenue", "net_income", "cash", "assets", "liabilities", "equity",
                "gross_margin", "operating_margin", "net_margin", "current_ratio",
                "debt_to_equity", "return_on_assets", "return_on_equity"
            ]:
                is_pct = c.unit.lower() in ["percent", "%"] or c.concept.endswith("margin") or c.concept.startswith("return_on")
                if is_pct and isinstance(c.value, (int, float)):
                    scaled_val = c.value * 100 if abs(c.value) <= 1.0 else c.value
                    val_str = f"{scaled_val:.2f}%"
                else:
                    val_str = f"${c.value:,.2f}" if c.unit.upper() == "USD" and isinstance(c.value, (int, float)) else (f"{c.value:,.2f} {c.unit}" if isinstance(c.value, (int, float)) and not c.unit.lower() == "shares" else f"{c.value} {c.unit}")
                
                snapshot_data.append([
                    f"[{c.id}]",
                    c.label or c.concept,
                    val_str,
                    f"{c.period_end} ({c.form})"
                ])

        t_snap = Table(snapshot_data, colWidths=[40, 200, 130, 130])
        t_snap.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#18181b')),
            ('TEXTCOLOR', (0,0), (-1,0), colors.white),
            ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
            ('BOTTOMPADDING', (0,0), (-1,0), 6),
            ('TOPPADDING', (0,0), (-1,0), 6),
            ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#e4e4e7')),
            ('FONTNAME', (0,1), (-1,-1), 'Helvetica'),
            ('FONTSIZE', (0,0), (-1,-1), 9),
            ('ALIGN', (2,0), (2,-1), 'RIGHT'),
        ]))
        story.append(t_snap)
        story.append(Spacer(1, 20))

        # --- CITATION APPENDIX ---
        if memo.citations:
            story.append(PageBreak())
            story.append(Paragraph("X. Sources & Citations Evidence", h1_style))
            story.append(Spacer(1, 10))
            
            citation_data = [["Ref", "Concept / Fact Source", "Period End (Form)", "Reported Value"]]
            for c in memo.citations:
                is_pct = c.unit.lower() in ["percent", "%"] or c.concept.endswith("margin") or c.concept.startswith("return_on")
                if is_pct and isinstance(c.value, (int, float)):
                    scaled_val = c.value * 100 if abs(c.value) <= 1.0 else c.value
                    val_str = f"{scaled_val:.2f}%"
                else:
                    val_str = f"${c.value:,.2f}" if c.unit.upper() == "USD" and isinstance(c.value, (int, float)) else (f"{c.value:,.2f} {c.unit}" if isinstance(c.value, (int, float)) and not c.unit.lower() == "shares" else f"{c.value} {c.unit}")
                
                citation_data.append([
                    f"[{c.id}]",
                    c.label or c.concept,
                    f"{c.period_end} ({c.form})",
                    val_str
                ])
            
            t_cit = Table(citation_data, colWidths=[30, 210, 130, 130])
            t_cit.setStyle(TableStyle([
                ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#f4f4f5')),
                ('TEXTCOLOR', (0,0), (-1,0), colors.HexColor('#18181b')),
                ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
                ('BOTTOMPADDING', (0,0), (-1,0), 6),
                ('TOPPADDING', (0,0), (-1,0), 6),
                ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#e4e4e7')),
                ('FONTNAME', (0,1), (-1,-1), 'Helvetica'),
                ('FONTSIZE', (0,0), (-1,-1), 8),
                ('ALIGN', (3,0), (3,-1), 'RIGHT'),
            ]))
            story.append(t_cit)
            
        doc.build(story)
        pdf_bytes = buffer.getvalue()
        buffer.close()
        return pdf_bytes
