THURAYA CLIENT APP — PC GOOD BASELINE

Purpose:
This package restores the last uploaded repo state before the later PC/mobile override attempts.
Use this as the new rollback baseline because the PC view was the closest approved visual direction.

Important working rule going forward:
- Do not add more patch CSS files.
- Freeze this baseline first.
- Future mobile work should adapt spacing/width only, not replace the visual theme.

Current loaded styling in index.html remains as it was in the uploaded repo:
- styles.css
- brand.css
- luxury-theme.css
- booking-scale-fix.css
- thuraya-unified-mobile-first.css
- inline style blocks already present in index.html

Booking logic files are untouched.
