/* Clinic Scout Meta Pixel — disabled pending governed release integration.
   No SDK loading, PageView/ViewContent/Lead queue, identifiers or ad export.
   This compatibility entry point intentionally does not report a sent event. */
(function() {
  'use strict';
  window.glpMetaTrackLead = function() { return ''; };
})();
