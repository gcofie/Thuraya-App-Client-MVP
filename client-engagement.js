
/* =========================================================
   THURAYA CLIENT ENGAGEMENT UI PATCH v1
   Safe UI-only helpers. No booking/Firebase writes.
   ========================================================= */
(function(){
  window.thurayaEngagementAction = function(action){
    if(action === "rebook"){
      var bookBtn = document.querySelector('[data-screen="booking"], #btnViewBookings, #btnToTech');
      var bookScreen = document.querySelector('[data-view="booking"], #bookingScreen, #booking');
      if(typeof showScreen === "function"){
        try { showScreen("booking"); return; } catch(e){}
      }
      if(bookBtn && typeof bookBtn.click === "function"){
        bookBtn.click();
        return;
      }
      alert("Rebook preview: this will open the booking flow.");
      return;
    }

    if(action === "directions"){
      alert("Directions preview: link this to Google Maps for 716, Lavista by Cosmo · Abelempke.");
      return;
    }

    if(action === "whatsapp"){
      alert("WhatsApp preview: link this to Thuraya WhatsApp contact.");
      return;
    }
  };
})();
