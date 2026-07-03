import { describe, it, expect } from 'vitest';
import {
  stripHtml,
  collapseWhitespace,
  shapeMessage,
  formatFrom,
  mailMode,
} from '../src/outlook-host';

describe('collapseWhitespace', () => {
  it('trims each line and collapses inner runs of spaces/tabs', () => {
    expect(collapseWhitespace('  a   b \t c  ')).toBe('a b c');
  });
  it('drops runs of blank lines down to one', () => {
    expect(collapseWhitespace('a\n\n\n\nb')).toBe('a\n\nb');
  });
  it('trims leading and trailing blank lines', () => {
    expect(collapseWhitespace('\n\n  hi  \n\n')).toBe('hi');
  });
});

describe('stripHtml', () => {
  it('turns <br> and block-close tags into newlines', () => {
    expect(stripHtml('<p>Hi</p><p>Bye</p>')).toBe('Hi\nBye');
    expect(stripHtml('one<br>two')).toBe('one\ntwo');
  });
  it('removes script/style blocks entirely', () => {
    expect(stripHtml('<style>.a{color:red}</style>text<script>x=1</script>')).toBe('text');
  });
  it('decodes the common entities', () => {
    expect(stripHtml('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &nbsp;f')).toBe(
      'a & b <c> "d" \'e\' f',
    );
  });
  it('strips arbitrary tags and collapses whitespace', () => {
    expect(stripHtml('<div>  <span>deadline</span>  is <b>Friday</b>  </div>')).toBe(
      'deadline is Friday',
    );
  });
});

describe('formatFrom', () => {
  it('renders "Name <addr>" when both present and differ', () => {
    expect(formatFrom({ displayName: 'Jane Doe', emailAddress: 'jane@law.example' })).toBe(
      'Jane Doe <jane@law.example>',
    );
  });
  it('falls back to the address when there is no display name', () => {
    expect(formatFrom({ emailAddress: 'jane@law.example' })).toBe('jane@law.example');
  });
  it('does not duplicate when name equals address', () => {
    expect(formatFrom({ displayName: 'jane@law.example', emailAddress: 'jane@law.example' })).toBe(
      'jane@law.example',
    );
  });
  it('undefined → empty string', () => {
    expect(formatFrom(undefined)).toBe('');
  });
});

describe('shapeMessage', () => {
  it('labels subject, from, then a body block separated by a blank line', () => {
    const out = shapeMessage({
      subject: 'Motion deadline',
      from: 'Jane Doe <jane@law.example>',
      body: 'Please file by Friday.',
    });
    expect(out).toBe('Subject: Motion deadline\nFrom: Jane Doe <jane@law.example>\n\nPlease file by Friday.');
  });
  it('omits empty fields (compose mode: no subject/from)', () => {
    expect(shapeMessage({ subject: '', from: '', body: 'draft in progress' })).toBe('draft in progress');
  });
  it('omits the body block when the body is empty', () => {
    expect(shapeMessage({ subject: 'Hi', from: '', body: '   ' })).toBe('Subject: Hi');
  });
  it('everything empty → empty string', () => {
    expect(shapeMessage({ subject: '', from: '', body: '' })).toBe('');
  });
});

describe('mailMode', () => {
  it('read when the item exposes a from', () => {
    expect(mailMode(true, false)).toBe('read');
    expect(mailMode(true, true)).toBe('read');
  });
  it('compose when there is no from but the body is writable', () => {
    expect(mailMode(false, true)).toBe('compose');
  });
  it('unknown when neither', () => {
    expect(mailMode(false, false)).toBe('unknown');
  });
});
