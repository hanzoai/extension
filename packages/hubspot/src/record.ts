// Record → context blocks — the pure bridge between the HubSpot CRM shapes
// (api/hubspot-api.CrmObject) and the model context (hanzo.ContextBlock[]). It
// decides WHICH properties to request per object type and HOW to order the
// primary record and its associated records into labeled blocks. No I/O: the
// serverless function fetches the objects, this arranges them, and hanzo
// windows+sends them. Kept separate so property selection and block ordering are
// tested without a network.

import type { CrmObject } from './api/hubspot-api.js';
import { renderProperties, type ContextBlock } from './hanzo.js';
import type { ObjectType } from './config.js';

// The properties we request per object type — the human-meaningful fields a rep
// cares about, not every internal HubSpot field. Requesting a curated set keeps
// the context focused (and the request small). hs_object_id is always present;
// we don't list it here because getObject returns the id separately.
export const DEFAULT_PROPERTIES: Record<ObjectType, readonly string[]> = {
  contacts: [
    'firstname',
    'lastname',
    'email',
    'phone',
    'jobtitle',
    'company',
    'lifecyclestage',
    'hs_lead_status',
    'notes_last_updated',
  ],
  companies: [
    'name',
    'domain',
    'industry',
    'phone',
    'city',
    'state',
    'country',
    'numberofemployees',
    'annualrevenue',
    'lifecyclestage',
  ],
  deals: [
    'dealname',
    'amount',
    'dealstage',
    'pipeline',
    'closedate',
    'dealtype',
    'hs_priority',
  ],
};

// The associated object types we pull for a given primary type — the context a
// rep would want alongside the record. A contact's companies + deals; a company's
// contacts + deals; a deal's contacts + companies. Ordered: the closest business
// context first. Empty groups (no associations) are simply omitted downstream.
export const ASSOCIATED_TYPES: Record<ObjectType, readonly ObjectType[]> = {
  contacts: ['companies', 'deals'],
  companies: ['contacts', 'deals'],
  deals: ['contacts', 'companies'],
};

// A short human label for an object type, singular where it reads better as a
// block heading. Pure.
export function typeLabel(type: ObjectType, plural: boolean): string {
  const singular: Record<ObjectType, string> = {
    contacts: 'Contact',
    companies: 'Company',
    deals: 'Deal',
  };
  const pluralMap: Record<ObjectType, string> = {
    contacts: 'Contacts',
    companies: 'Companies',
    deals: 'Deals',
  };
  return plural ? pluralMap[type] : singular[type];
}

// renderObjectList turns a list of associated records of one type into one text
// block: each record's properties rendered, separated by a rule. Capped at
// `max` records so a contact with 200 deals doesn't dominate the context; the
// caller's budget windowing is the final guard, this is a courtesy cap on
// breadth. Pure.
export function renderObjectList(objects: CrmObject[], max = 10): string {
  return objects
    .slice(0, max)
    .map((o) => renderProperties(o.properties))
    .filter((s) => s.length > 0)
    .join('\n---\n');
}

// buildContextBlocks arranges the primary record and its association groups into
// the ordered ContextBlock[] the model context is assembled from. The primary
// record is ALWAYS first (so it survives budget truncation); each non-empty
// association group follows in ASSOCIATED_TYPES order. Pure — unit-tested with
// plain CrmObjects.
export function buildContextBlocks(
  primaryType: ObjectType,
  primary: CrmObject,
  associations: Partial<Record<ObjectType, CrmObject[]>>,
): ContextBlock[] {
  const blocks: ContextBlock[] = [
    { label: typeLabel(primaryType, false), text: renderProperties(primary.properties) },
  ];
  for (const assocType of ASSOCIATED_TYPES[primaryType]) {
    const list = associations[assocType];
    if (list && list.length > 0) {
      blocks.push({
        label: `Associated ${typeLabel(assocType, true)}`,
        text: renderObjectList(list),
      });
    }
  }
  return blocks;
}
