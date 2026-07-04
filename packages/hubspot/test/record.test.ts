import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PROPERTIES,
  ASSOCIATED_TYPES,
  typeLabel,
  renderObjectList,
  buildContextBlocks,
} from '../src/record.js';
import type { CrmObject } from '../src/api/hubspot-api.js';

const contact: CrmObject = {
  id: '1',
  properties: { firstname: 'Ada', lastname: 'Lovelace', email: 'ada@x.com' },
};
const deal: CrmObject = { id: '9', properties: { dealname: 'Big deal', amount: '5000' } };
const company: CrmObject = { id: '7', properties: { name: 'Acme', domain: 'acme.com' } };

describe('property + association config', () => {
  it('requests curated properties per type', () => {
    expect(DEFAULT_PROPERTIES.contacts).toContain('email');
    expect(DEFAULT_PROPERTIES.deals).toContain('amount');
    expect(DEFAULT_PROPERTIES.companies).toContain('domain');
  });
  it('associates each type with its business context, in order', () => {
    expect(ASSOCIATED_TYPES.contacts).toEqual(['companies', 'deals']);
    expect(ASSOCIATED_TYPES.deals).toEqual(['contacts', 'companies']);
  });
});

describe('typeLabel', () => {
  it('gives singular and plural labels', () => {
    expect(typeLabel('deals', false)).toBe('Deal');
    expect(typeLabel('companies', true)).toBe('Companies');
    expect(typeLabel('contacts', false)).toBe('Contact');
  });
});

describe('renderObjectList', () => {
  it('renders each record and separates with a rule', () => {
    const s = renderObjectList([deal, { id: '10', properties: { dealname: 'Small' } }]);
    expect(s).toContain('dealname: Big deal');
    expect(s).toContain('dealname: Small');
    expect(s).toContain('\n---\n');
  });
  it('caps the number of records rendered', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: String(i),
      properties: { dealname: `D${i}` },
    }));
    const s = renderObjectList(many, 3);
    expect(s).toContain('D0');
    expect(s).toContain('D2');
    expect(s).not.toContain('D3');
  });
  it('drops records with no renderable properties', () => {
    expect(renderObjectList([{ id: '1', properties: {} }])).toBe('');
  });
});

describe('buildContextBlocks', () => {
  it('puts the primary record first, then non-empty association groups in order', () => {
    const blocks = buildContextBlocks('contacts', contact, {
      companies: [company],
      deals: [deal],
    });
    expect(blocks.map((b) => b.label)).toEqual([
      'Contact',
      'Associated Companies',
      'Associated Deals',
    ]);
    expect(blocks[0].text).toContain('firstname: Ada');
    expect(blocks[1].text).toContain('name: Acme');
    expect(blocks[2].text).toContain('dealname: Big deal');
  });

  it('omits empty association groups', () => {
    const blocks = buildContextBlocks('contacts', contact, { companies: [], deals: [deal] });
    expect(blocks.map((b) => b.label)).toEqual(['Contact', 'Associated Deals']);
  });

  it('works with no associations at all', () => {
    const blocks = buildContextBlocks('deals', deal, {});
    expect(blocks).toHaveLength(1);
    expect(blocks[0].label).toBe('Deal');
  });
});
