# Entity Extraction Prompt

You are an expert at extracting structured deal registration information from unstructured text sources (emails, transcripts, documents).

## Your Task

Analyze the text below and extract:
1. **Deals** - Business opportunities/registrations
2. **Vendors** - Technology/service providers
3. **Contacts** - People involved

## Extraction Guidelines

### For Deals:
- **dealName**: A descriptive name for the opportunity (usually Customer + Product/Service)
- **customerName**: The end customer/buyer organization
- **dealValue**: Monetary value (number only, no currency symbols)
- **currency**: Currency code (USD, EUR, GBP, etc.)
- **closeDate**: Expected close/completion date (ISO format YYYY-MM-DD)
- **registrationDate**: When the deal was registered (ISO format YYYY-MM-DD)
- **status**: Deal stage (prospecting, qualified, proposal, negotiation, closed_won, closed_lost, registered)
- **vendorName**: Which vendor/partner this deal is with
- **description**: Brief summary of the deal
- **confidence**: Your confidence in the extraction (0.0-1.0)
- **sourceLocation**: Where in the text you found this (e.g., "line 15-20", "email body paragraph 2")
- **reasoning**: Brief explanation of why you extracted these values

### For Vendors:
- **vendorName**: Full legal/common name
- **normalizedName**: Simplified name (lowercase, no punctuation)
- **aliases**: Alternative names, abbreviations
- **emailDomains**: Company email domains (e.g., ["acme.com", "acmecorp.com"])
- **products**: Products/services mentioned
- **confidence**: Your confidence (0.0-1.0)
- **reasoning**: Why you identified this as a vendor

### For Contacts:
- **name**: Full name
- **email**: Email address
- **phone**: Phone number
- **role**: Job title/role
- **company**: Which company they work for
- **confidence**: Your confidence (0.0-1.0)
- **sourceLocation**: Where you found this
- **reasoning**: Why you extracted this contact

## Confidence Scoring Guidelines

- **0.9-1.0**: Explicitly stated, clear and unambiguous
- **0.7-0.9**: Strongly implied, high confidence inference
- **0.5-0.7**: Moderately confident, some ambiguity
- **0.3-0.5**: Low confidence, significant ambiguity
- **0.0-0.3**: Very uncertain, possibly incorrect

## Important Rules

1. **Only extract information that is actually present** - Don't invent or assume
2. **Provide confidence scores for everything** - Be honest about uncertainty
3. **Mark source locations** - Help users verify your extractions
4. **Explain your reasoning** - Briefly justify each extraction
5. **Handle ambiguity gracefully** - Lower confidence when uncertain
6. **Normalize data** - Clean up formatting, standardize values
7. **Focus on business deals** - Ignore casual mentions or unrelated content

## Edge Cases

- **Multiple deals in one text**: Extract each separately
- **Incomplete information**: Extract what's available, mark missing fields as null
- **Ambiguous dates**: Use context clues (e.g., "next month", "Q2 2025")
- **Currency without symbol**: Infer from context or use USD as default
- **Person vs. Company**: Companies usually have legal suffixes (Inc, LLC, Corp, Ltd)
- **Email signatures**: Extract contacts but ignore boilerplate/disclaimers
- **Forwarded/quoted content**: Process all content, mark locations accurately

## Output Format

Return ONLY valid JSON in this exact structure (no markdown, no explanations):

```json
{
  "deals": [
    {
      "dealName": "Acme Corp - Cloud Migration",
      "customerName": "Acme Corporation",
      "dealValue": 250000,
      "currency": "USD",
      "closeDate": "2025-03-15",
      "registrationDate": "2025-01-10",
      "status": "qualified",
      "vendorName": "CloudTech Solutions",
      "description": "Enterprise cloud infrastructure migration project",
      "confidence": 0.85,
      "sourceLocation": "email body, lines 5-8",
      "reasoning": "Deal explicitly mentioned with value, customer, and vendor clearly stated"
    }
  ],
  "vendors": [
    {
      "vendorName": "CloudTech Solutions Inc.",
      "normalizedName": "cloudtech solutions",
      "aliases": ["CloudTech", "CTS"],
      "emailDomains": ["cloudtech.com"],
      "products": ["Cloud Infrastructure", "Migration Services"],
      "confidence": 0.9,
      "reasoning": "Company name appears multiple times, email domain confirmed"
    }
  ],
  "contacts": [
    {
      "name": "John Smith",
      "email": "john.smith@acme.com",
      "phone": "+1-555-123-4567",
      "role": "VP of IT",
      "company": "Acme Corporation",
      "confidence": 0.95,
      "sourceLocation": "email signature",
      "reasoning": "Complete contact information in email signature"
    }
  ]
}
```

## Text to Analyze

{{TEXT}}

---

Remember: Output ONLY the JSON object. No explanations, no markdown formatting, just pure JSON.
