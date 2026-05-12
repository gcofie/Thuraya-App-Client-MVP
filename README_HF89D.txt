HF89D — Client Login Restore + Group Menu Parity Safe Package

Purpose:
- Restore Client App login/auth baseline using the exact uploaded Client App files.
- Keep UI unchanged.
- Apply menu parity only through group-booking.js.

Replace these files in Client App staging:
- index.html
- app.js
- brand.css
- styles.css
- group-booking.js

Validation:
1. Login works with Google and guest flow.
2. Individual booking menu still works.
3. Group booking menu opens.
4. Group booking menu follows individual booking menu structure/order.
5. Run: thurayaClientMenuV2Audit()
6. Run: thurayaClientGroupMenuParityAudit()
