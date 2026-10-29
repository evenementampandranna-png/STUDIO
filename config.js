/* Réglages du site.
   firebase : laissez null tant que Firebase n'est pas configuré (les réponses passent alors par WhatsApp).
   contact  : numéro WhatsApp affiché sur la vitrine pour les demandes de devis. */
window.STUDIO_CONFIG = {
  firebase: null,
  contact: { nom: 'Studio d\'invitations', whatsapp: '', facebook: '' }
};
