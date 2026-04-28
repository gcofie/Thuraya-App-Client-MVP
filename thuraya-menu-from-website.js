// ============================================================
// THURAYA — Website Service Menu Seed
// Source: thurayanailbar.com/service-menu
// Run once in browser console after Firebase loads:
//     seedThurayaWebsiteMenu()
// ============================================================

const THURAYA_WEBSITE_MENU = [
  // FOOT THERAPIES — Foundation Rituals
  { department:'Foot', mainCategory:'I. FOOT THERAPIES', subCategory:'A. FOUNDATION RITUALS', name:'Silk Skin Ritual', duration:75, price:400, inputType:'radio', sortOrder:10, subSortOrder:10, desc:'A refined aromatherapy foot immersion designed to restore depleted skin and nails, soften visible dryness, and return the feet to a clean, healthy, composed state.' },
  { department:'Foot', mainCategory:'I. FOOT THERAPIES', subCategory:'A. FOUNDATION RITUALS', name:'The Refinement Indulgence', duration:65, price:420, inputType:'radio', sortOrder:20, subSortOrder:10, desc:'A smoothing medicure ritual focused on renewing the skin surface, gently releasing hardened areas, and restoring softness, clarity and radiance.' },
  { department:'Foot', mainCategory:'I. FOOT THERAPIES', subCategory:'A. FOUNDATION RITUALS', name:'Rituel Jeunesse (Teen Ritual)', duration:50, price:324, inputType:'radio', sortOrder:30, subSortOrder:10, desc:'A refined teen foot ritual designed to restore depleted skin and nails and return the feet to a clean, healthy, composed state.' },
  { department:'Foot', mainCategory:'I. FOOT THERAPIES', subCategory:'A. FOUNDATION RITUALS', name:'Essential Foot Reset (Men)', duration:75, price:450, inputType:'radio', sortOrder:40, subSortOrder:10, desc:'A smoothing medicure ritual designed for men, focused on renewing skin surface, releasing hardened areas and restoring softness.' },

  // FOOT THERAPIES — Urban Express
  { department:'Foot', mainCategory:'I. FOOT THERAPIES', subCategory:'B. URBAN EXPRESS RITUALS', name:'Rapid Reboot', duration:40, price:350, inputType:'radio', sortOrder:50, subSortOrder:20, desc:'An express heel refinement and nail tidy ritual for time-conscious clients seeking immediate polished results.' },

  // FOOT THERAPIES — Medi Cleanse
  { department:'Foot', mainCategory:'I. FOOT THERAPIES', subCategory:'C. MEDI-CLEANSE SERIES', name:'Heel Harmony Peel', duration:35, price:150, inputType:'checkbox', sortOrder:60, subSortOrder:30, desc:'A corrective peel that removes hardened callus and restores optimal heel pH. Recommended as an add-on to quick services or while waiting at check-in.' },

  // ADD ONS & UPGRADES — Finishing Indulgences
  { department:'Both', mainCategory:'ADD ONS & UPGRADES', subCategory:'A. THE FINISHING INDULGENCES', name:'Lush Arm Sculpt', duration:20, price:70, inputType:'checkbox', sortOrder:10, subSortOrder:10, desc:'Elbow to fingertip massage for renewal.' },
  { department:'Both', mainCategory:'ADD ONS & UPGRADES', subCategory:'A. THE FINISHING INDULGENCES', name:'Paraffin Restoration Mask', duration:20, price:70, inputType:'checkbox', sortOrder:20, subSortOrder:10, desc:'Therapeutic deep-heat hydration seal that locks in moisture, softens cracked dry skin, supports circulation and relaxes muscles.' },
  { department:'Both', mainCategory:'ADD ONS & UPGRADES', subCategory:'A. THE FINISHING INDULGENCES', name:'Hot Stone Arm Massage', duration:20, price:90, inputType:'checkbox', sortOrder:30, subSortOrder:10, desc:'Deep muscle release, circulation and relaxation massage to reduce stress and relieve chronic pain.' },

  // ADD ONS & UPGRADES — Polish & Finish
  { department:'Both', mainCategory:'ADD ONS & UPGRADES', subCategory:'B. POLISH & FINISH', name:'Classic Lacquer', duration:0, price:0, inputType:'checkbox', sortOrder:40, subSortOrder:20, tag:'Included', desc:'Complimentary finish for services in the hand rituals suite.' },
  { department:'Both', mainCategory:'ADD ONS & UPGRADES', subCategory:'B. POLISH & FINISH', name:'Gel Classic', duration:15, price:80, inputType:'checkbox', sortOrder:50, subSortOrder:20, desc:'Alternative polish finish to classic lacquer.' },
  { department:'Both', mainCategory:'ADD ONS & UPGRADES', subCategory:'B. POLISH & FINISH', name:'French Manicure Finish', duration:30, price:80, inputType:'checkbox', sortOrder:60, subSortOrder:20, desc:'French finish upgrade.' },
  { department:'Both', mainCategory:'ADD ONS & UPGRADES', subCategory:'B. POLISH & FINISH', name:'Chrome / Ombré', duration:20, price:150, inputType:'checkbox', sortOrder:70, subSortOrder:20, desc:'Chrome or ombré finish upgrade.' },

  // HAND THERAPIES
  { department:'Hand', mainCategory:'I. HAND THERAPY RITUALS', subCategory:'I. HAND THERAPIES', name:'Youthful Touch (Hand Renewal)', duration:55, price:265, inputType:'radio', sortOrder:10, subSortOrder:10, desc:'Focused anti-ageing, wrinkle-smoothing, moisture-restoring hand ritual designed to improve suppleness and tone.' },
  { department:'Hand', mainCategory:'I. HAND THERAPY RITUALS', subCategory:'I. HAND THERAPIES', name:'Silken Restore (Hand Balance)', duration:30, price:197, inputType:'radio', sortOrder:20, subSortOrder:10, desc:'Targeted hydration and skin-correction ritual addressing dryness, texture and loss of elasticity.' },
  { department:'Hand', mainCategory:'I. HAND THERAPY RITUALS', subCategory:'I. HAND THERAPIES', name:'Groom Precision (Men)', duration:55, price:265, inputType:'radio', sortOrder:30, subSortOrder:10, desc:"Clean, practical, hygienic men's grooming for refined, well-kept hands." },

  // PLEIADES STUDIO — Nail Architecture / Acrylic
  { department:'Hand', mainCategory:'II. PLEIADES STUDIO', subCategory:'Acrylic Extensions: Tip & Sculpt Build', name:'Acrylic Builder Extension - Full Set', duration:75, price:350, inputType:'radio', sortOrder:10, subSortOrder:10, desc:'Standard artificial nail extensions with acrylic builder and complimentary classic lacquer finish. Nail art not included.' },
  { department:'Hand', mainCategory:'II. PLEIADES STUDIO', subCategory:'Acrylic Extensions: Tip & Sculpt Build', name:'Acrylic Builder Extension - Refill Set', duration:50, price:250, inputType:'radio', sortOrder:20, subSortOrder:10, desc:'Standard artificial nail extension refill with acrylic builder and complimentary classic lacquer finish. Nail art not included.' },
  { department:'Hand', mainCategory:'II. PLEIADES STUDIO', subCategory:'Acrylic Extensions: Tip & Sculpt Build', name:'Acrylic Sculpt Extension - Full Set', duration:75, price:380, inputType:'radio', sortOrder:30, subSortOrder:10, desc:'Standard artificial nail extensions with acrylic sculpt application and complimentary classic lacquer finish. Nail art not included.' },
  { department:'Hand', mainCategory:'II. PLEIADES STUDIO', subCategory:'Acrylic Extensions: Tip & Sculpt Build', name:'Acrylic Sculpt Extension - Refill Set', duration:60, price:250, inputType:'radio', sortOrder:40, subSortOrder:10, desc:'Standard artificial nail extension refill with acrylic sculpt application. Nail art not included.' },

  // PLEIADES STUDIO — Gel Extensions
  { department:'Hand', mainCategory:'II. PLEIADES STUDIO', subCategory:'Gel Extensions: Gel-X / BIAB / Duragel', name:'Gel Extension - Full Set', duration:60, price:350, inputType:'radio', sortOrder:50, subSortOrder:20, desc:'Standard artificial nail extensions with complimentary classic lacquer finish. Nail art not included.' },
  { department:'Hand', mainCategory:'II. PLEIADES STUDIO', subCategory:'Gel Extensions: Gel-X / BIAB / Duragel', name:'Gel Extension - Refill Set', duration:50, price:250, inputType:'radio', sortOrder:60, subSortOrder:20, desc:'Standard gel extension refill with complimentary classic lacquer finish. Nail art not included.' },
  { department:'Hand', mainCategory:'II. PLEIADES STUDIO', subCategory:'Gel Extensions: Gel-X / BIAB / Duragel', name:'Gel Overlay - Full Set', duration:50, price:280, inputType:'radio', sortOrder:70, subSortOrder:20, desc:'Gel overlay full set.' },
  { department:'Hand', mainCategory:'II. PLEIADES STUDIO', subCategory:'Gel Extensions: Gel-X / BIAB / Duragel', name:'Gel Overlay - Refill Set', duration:50, price:200, inputType:'radio', sortOrder:80, subSortOrder:20, desc:'Gel overlay refill set.' },
  { department:'Hand', mainCategory:'II. PLEIADES STUDIO', subCategory:'Gel Extensions: Gel-X / BIAB / Duragel', name:'Nail Repair - All Application Types', duration:0, price:25, inputType:'counter', sortOrder:90, subSortOrder:20, desc:'Repair service charged per nail.' },

  // DESIGNER CANVAS — Editorial Nail Art
  { department:'Hand', mainCategory:'DESIGNER CANVAS', subCategory:'Editorial Nail Art', name:'Simple Art', duration:25, price:10, inputType:'counter', sortOrder:10, subSortOrder:10, desc:'Minimal editorial nail art, charged per finger.' },
  { department:'Hand', mainCategory:'DESIGNER CANVAS', subCategory:'Editorial Nail Art', name:'3D Art', duration:25, price:10, inputType:'counter', sortOrder:20, subSortOrder:10, desc:'Custom 3D nail art add-on, charged per finger.' },
  { department:'Hand', mainCategory:'DESIGNER CANVAS', subCategory:'Editorial Nail Art', name:'Detailed Art', duration:45, price:15, inputType:'counter', sortOrder:30, subSortOrder:10, desc:'Detailed editorial nail art for a pronounced yet restrained look.' },

  // DESIGNER CANVAS — Couture
  { department:'Hand', mainCategory:'DESIGNER CANVAS', subCategory:'Couture Nail Art', name:'Full Custom Design', duration:90, price:0, inputType:'checkbox', sortOrder:40, subSortOrder:20, tag:'Consultation', desc:'Highly detailed custom-designed nail creation. Final pricing is determined after consultation.' },

  // EMBELLISHMENTS
  { department:'Hand', mainCategory:'EMBELLISHMENTS DRAWERS', subCategory:'Stones, Crystals & Embellishments', name:'Stones & Crystals', duration:0, price:10, inputType:'counter', sortOrder:10, subSortOrder:10, desc:'Custom embellishments with stones and crystals, starting from GHS10 per finger.' },
  { department:'Hand', mainCategory:'EMBELLISHMENTS DRAWERS', subCategory:'Stones, Crystals & Embellishments', name:'Metals / Pearls / Others', duration:0, price:5, inputType:'counter', sortOrder:20, subSortOrder:10, desc:'Custom embellishments with metals, pearls or other accents, starting from GHS5 per finger.' }
];

function slugifyMenuId(name) {
  return name.toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

window.seedThurayaWebsiteMenu = async function() {
  if (!window.db || !window.firebase) {
    alert('Firebase is not ready yet. Open the app page, wait for it to load, then run seedThurayaWebsiteMenu().');
    return;
  }
  const batch = db.batch();
  THURAYA_WEBSITE_MENU.forEach((item, index) => {
    const id = slugifyMenuId(`${item.department}-${item.mainCategory}-${item.subCategory}-${item.name}`);
    const ref = db.collection('Menu_Services').doc(id);
    batch.set(ref, {
      ...item,
      category: item.subCategory,
      status: item.status || 'Active',
      source: 'thurayanailbar.com/service-menu',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      menuVersion: 'website-2026-04-28',
      sortOrder: item.sortOrder ?? index,
    }, { merge: true });
  });
  await batch.commit();
  alert(`✅ Thuraya website menu seeded: ${THURAYA_WEBSITE_MENU.length} services updated.`);
};

console.log('Thuraya website menu seed loaded. Run seedThurayaWebsiteMenu() once to update Menu_Services.');
