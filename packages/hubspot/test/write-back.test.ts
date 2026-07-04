import { describe, it, expect } from 'vitest';
import {
  noteWriteBack,
  taskWriteBack,
  NOTE_ASSOCIATION_TYPE_ID,
  TASK_ASSOCIATION_TYPE_ID,
  ASSOCIATION_CATEGORY,
} from '../src/api/write-back.js';

const TS = '2026-07-03T12:00:00.000Z';

describe('association type id tables', () => {
  it('matches HubSpot HUBSPOT_DEFINED note defaults', () => {
    expect(NOTE_ASSOCIATION_TYPE_ID).toEqual({ contacts: 202, companies: 190, deals: 214 });
  });
  it('matches HubSpot HUBSPOT_DEFINED task defaults', () => {
    expect(TASK_ASSOCIATION_TYPE_ID).toEqual({ contacts: 204, companies: 192, deals: 216 });
  });
});

describe('noteWriteBack', () => {
  it('builds a note payload with body, timestamp, and the default contact edge', () => {
    const p = noteWriteBack('contacts', '123', 'Great call, ready to move forward.', TS);
    expect(p).toEqual({
      properties: {
        hs_note_body: 'Great call, ready to move forward.',
        hs_timestamp: TS,
      },
      associations: [
        {
          to: { id: '123' },
          types: [{ associationCategory: ASSOCIATION_CATEGORY, associationTypeId: 202 }],
        },
      ],
    });
  });

  it('uses the deal edge (214) for a deal record', () => {
    const p = noteWriteBack('deals', '900', 'x', TS);
    expect(p.associations[0].types[0].associationTypeId).toBe(214);
    expect(p.associations[0].to.id).toBe('900');
  });

  it('uses the company edge (190) for a company record', () => {
    const p = noteWriteBack('companies', '5', 'x', TS);
    expect(p.associations[0].types[0].associationTypeId).toBe(190);
  });

  it('defaults the timestamp to a real ISO string when omitted', () => {
    const p = noteWriteBack('contacts', '1', 'x');
    expect(p.properties.hs_timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('passes the body through unchanged (no markup injection)', () => {
    const body = 'Line 1\n\nLine 2 with <b>bold</b> & symbols';
    const p = noteWriteBack('contacts', '1', body, TS);
    expect(p.properties.hs_note_body).toBe(body);
  });
});

describe('taskWriteBack', () => {
  it('builds a task payload with subject, body, status/priority, due, and the default edge', () => {
    const p = taskWriteBack('deals', '42', 'Follow up on pricing', 'Send the revised quote', TS);
    expect(p).toEqual({
      properties: {
        hs_task_subject: 'Follow up on pricing',
        hs_task_body: 'Send the revised quote',
        hs_task_status: 'NOT_STARTED',
        hs_task_priority: 'MEDIUM',
        hs_timestamp: TS,
      },
      associations: [
        {
          to: { id: '42' },
          types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 216 }],
        },
      ],
    });
  });

  it('uses the contact task edge (204)', () => {
    const p = taskWriteBack('contacts', '1', 's', 'b', TS);
    expect(p.associations[0].types[0].associationTypeId).toBe(204);
  });

  it('defaults the due timestamp when omitted', () => {
    const p = taskWriteBack('contacts', '1', 's', 'b');
    expect(p.properties.hs_timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
