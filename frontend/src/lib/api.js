Updated package ready:

[CRM_UPR-replacement-files-v2.zip](C:\Users\vranda%20aggarwal\Documents\Codex\2026-08-05\hey-i-am-attaching-the-zip\outputs\CRM_UPR-replacement-files-v2.zip)

Replace these four files in GitHub:

1. `frontend/src/pages/Leads.jsx`
2. `frontend/src/pages/LeadDetail.jsx`
3. `frontend/src/lib/api.js`
4. `backend/server.py`

Changes included:

- Call icon directly opens the phone’s native dialer.
- Name and number still open the complete lead interface.
- WhatsApp icon opens an individual chat; 10-digit phone numbers automatically use India’s `+91` country code.
- Added “All properties / Resale properties / Rent properties” dropdown filter.
- No recording prompt when using the list call icon.

Redeploy frontend and backend after replacing the files.
