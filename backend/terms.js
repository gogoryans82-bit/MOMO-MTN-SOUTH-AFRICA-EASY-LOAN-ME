// ============================================================
// terms.js – MTN MoMo South Africa Loan Terms & Conditions
// Bump TNC_VERSION whenever the text changes
// ============================================================
'use strict';

const TNC_VERSION = '1.0';
const TNC_EFFECTIVE = '2026-01-01';

const TERMS_TEXT = `MTN MOMO SOUTH AFRICA – LOAN TERMS & CONDITIONS
Version ${TNC_VERSION} · Effective ${TNC_EFFECTIVE}

1. PARTIES
This agreement is entered into between MTN MoMo South Africa ("the
Lender") and the applicant whose details are captured during
registration ("the Borrower").

2. ELIGIBILITY
   • Must be 18 years or older (verified via SA ID)
   • Must hold a valid 13-digit South African ID number
   • Must have an active MTN MoMo wallet
   • Must provide accurate personal and contact information

3. LOAN TERMS
   • Minimum loan amount: R 5,000
   • Maximum loan amount: determined by the Borrower's MoMo account
     type (Yello / Yello Plus / Eazi)
   • Interest rate: 27% per annum, compounded monthly
   • Repayment: fixed monthly instalments per the agreed schedule
   • No hidden fees — all charges disclosed before acceptance

4. QUALIFICATION REQUIREMENT
The Borrower must demonstrate MoMo transaction activity equal to
20% of the requested loan amount in the current month (Option A),
OR provide a MoMo-registered guarantor (Option B).

5. GUARANTOR
   • The guarantor accepts joint and several liability for repayment
   • The guarantor confirms their consent to act as guarantor
   • On default by the Borrower, the Lender may recover the full
     outstanding balance from the Guarantor

6. REPAYMENT
   • First instalment is due 30 days after disbursement
   • Payments are debited from the Borrower's MoMo wallet
   • Early settlement is permitted at any time without penalty

7. DEFAULT
If the Borrower fails to pay any instalment within 5 (five) days of
the due date, the loan is in default. Consequences may include:
   • Late payment penalty as prescribed by the National Credit Act
   • Legal recovery action and costs
   • Negative listing with credit bureaus
   • Immediate liability of the Guarantor

8. POPIA & DATA CONSENT
By accepting these Terms, the Borrower expressly consents to:
   • Collection of ID number, DOB, phone, email, and MoMo
     transaction history
   • Verification of the SA ID via the Department of Home Affairs
   • Sharing of relevant data with credit bureaus and MTN MoMo
   • Processing of data for loan assessment, disbursement,
     and recovery purposes

9. COOLING-OFF PERIOD
The Borrower may cancel this agreement within 5 (five) business
days of acceptance without penalty.

10. DISPUTE RESOLUTION
Disputes shall be resolved through the National Credit Regulator
or the National Consumer Tribunal.

11. GOVERNING LAW
This agreement is governed by the laws of the Republic of South
Africa, including the National Credit Act 34 of 2005.

12. ACCEPTANCE
By ticking the acceptance box at registration, the Borrower confirms:
   • They have read and understood these Terms
   • All information provided is accurate and complete
   • They are 18 years or older
   • They accept liability jointly with the Guarantor

© 2026 MTN MoMo South Africa · All rights reserved`;

module.exports = { TNC_VERSION, TNC_EFFECTIVE, TERMS_TEXT };
