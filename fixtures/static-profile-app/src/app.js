import { profileFields, renderProfileFields } from './profile.js';

const contactList = document.querySelector('[data-profile-fields]');

if (!(contactList instanceof HTMLDListElement)) {
  throw new Error('Profile contact list was not found.');
}

contactList.innerHTML = renderProfileFields(profileFields);
