// Engagement write-back payload assembly — pure. Turns AI output into the exact
// create body for a HubSpot Note or Task engagement, associated to the record
// the card is mounted on. No I/O: the payloads produced here are handed to
// api/hubspot-api.createNote / createTask for the actual POST, so the payload
// shape (the load-bearing part) is unit-tested independently of the wire.
//
// HubSpot models Notes and Tasks as CRM objects. Creating one WITH an inline
// association uses the default HUBSPOT_DEFINED association type for the
// (engagement → record) direction. The type ids are HubSpot's documented
// defaults per object type; unidirectional (note→contact ≠ contact→note).

import type { ObjectType } from '../config.js';

// Default HUBSPOT_DEFINED association type ids, engagement → record. These are
// HubSpot's stable defaults (developers.hubspot.com association type reference).
// A portal can define custom labels, but the DEFAULT edge is what a fresh
// association uses and what the CRM UI shows on the record timeline.
export const NOTE_ASSOCIATION_TYPE_ID: Record<ObjectType, number> = {
  contacts: 202,
  companies: 190,
  deals: 214,
};
export const TASK_ASSOCIATION_TYPE_ID: Record<ObjectType, number> = {
  contacts: 204,
  companies: 192,
  deals: 216,
};

// The HubSpot association-category discriminator. We only ever create the
// platform's built-in edges, so this is always HUBSPOT_DEFINED.
export const ASSOCIATION_CATEGORY = 'HUBSPOT_DEFINED' as const;

// One inline association in a create body. `to.id` is the record this engagement
// attaches to; `types[]` is the single default edge.
interface AssociationSpec {
  to: { id: string };
  types: Array<{ associationCategory: typeof ASSOCIATION_CATEGORY; associationTypeId: number }>;
}

// association builds the inline association block for an engagement→record edge.
function association(objectId: string, typeId: number): AssociationSpec {
  return {
    to: { id: objectId },
    types: [{ associationCategory: ASSOCIATION_CATEGORY, associationTypeId: typeId }],
  };
}

// The Note create payload.
export interface NoteWriteBack {
  properties: {
    hs_note_body: string;
    hs_timestamp: string;
  };
  associations: AssociationSpec[];
}

// The Task create payload. hs_task_status/priority default to a sensible open,
// not-urgent task; hs_task_subject is the one-line title, hs_task_body the
// detail. hs_timestamp on a task is its DUE date.
export interface TaskWriteBack {
  properties: {
    hs_task_subject: string;
    hs_task_body: string;
    hs_task_status: string;
    hs_task_priority: string;
    hs_timestamp: string;
  };
  associations: AssociationSpec[];
}

// nowIso returns the current time as the ISO-8601 string HubSpot's timestamp
// properties accept. Isolated so tests inject a fixed clock (nowIso is only
// called when the caller doesn't pass an explicit timestamp).
function nowIso(): string {
  return new Date().toISOString();
}

// noteWriteBack assembles the create payload for a Note carrying AI output,
// associated to the current record. `timestamp` defaults to now (a note's
// timestamp is when it was logged). Pure given an explicit timestamp — the one
// unit under test. The body is HTML-capable in HubSpot; we pass the model's text
// through unchanged (the caller decides formatting) and never inject markup.
export function noteWriteBack(
  objectType: ObjectType,
  objectId: string,
  body: string,
  timestamp: string = nowIso(),
): NoteWriteBack {
  return {
    properties: {
      hs_note_body: body,
      hs_timestamp: timestamp,
    },
    associations: [association(objectId, NOTE_ASSOCIATION_TYPE_ID[objectType])],
  };
}

// taskWriteBack assembles the create payload for a follow-up Task, associated to
// the current record. subject is the title (required, non-empty); body is the
// detail. `dueTimestamp` defaults to now (surfaces immediately on the task
// queue); a caller schedules it forward by passing a future ISO string. Pure
// given an explicit timestamp.
export function taskWriteBack(
  objectType: ObjectType,
  objectId: string,
  subject: string,
  body: string,
  dueTimestamp: string = nowIso(),
): TaskWriteBack {
  return {
    properties: {
      hs_task_subject: subject,
      hs_task_body: body,
      hs_task_status: 'NOT_STARTED',
      hs_task_priority: 'MEDIUM',
      hs_timestamp: dueTimestamp,
    },
    associations: [association(objectId, TASK_ASSOCIATION_TYPE_ID[objectType])],
  };
}
