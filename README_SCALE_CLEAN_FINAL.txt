THURAYA CLIENT APP — SCALE CLEAN FINAL

Applied fixes:
1. Removed mobile-scale.css link from index.html.
2. Removed broken client-engagement.css link from index.html because file was not present.
3. Kept booking-scale-fix.css as the single mobile scale stylesheet.
4. Added explicit mobile override: .screen.active { display:block !important; }
5. Added defensive .screen-inner max-width caps to prevent 760px desktop width leaking into booking screens.
6. No JavaScript booking logic was changed.
