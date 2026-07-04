import { describe, it, expect } from 'vitest';
import {
  htmlToText,
  renderCourseOverview,
  renderAssignment,
  renderSubmission,
  renderDiscussion,
  renderPage,
  renderModule,
  renderEnrollment,
  buildCourseContext,
  contextNote,
  courseSection,
  moduleSection,
  assignmentSection,
  pageSection,
  discussionSection,
  submissionSection,
  enrollmentSection,
} from '../src/course.js';
import type {
  Course,
  Assignment,
  Submission,
  Discussion,
  Page_,
  Module,
  Enrollment,
} from '../src/canvas-api.js';

describe('course: htmlToText', () => {
  it('strips tags, breaks blocks, and decodes entities', () => {
    const html = '<h2>Syllabus</h2><p>Read &amp; annotate ch.&nbsp;1.</p><ul><li>Quiz</li><li>Lab</li></ul>';
    const text = htmlToText(html);
    expect(text).toContain('Syllabus');
    expect(text).toContain('Read & annotate ch. 1.');
    expect(text).toContain('• Quiz');
    expect(text).toContain('• Lab');
    expect(text).not.toContain('<');
  });
  it('decodes numeric entities and collapses whitespace', () => {
    expect(htmlToText('a&#39;b')).toBe("a'b");
    expect(htmlToText('x    y')).toBe('x y');
  });
  it('returns empty for empty/whitespace input', () => {
    expect(htmlToText('')).toBe('');
    expect(htmlToText('<p>   </p>')).toBe('');
  });
});

const course: Course = {
  id: 1,
  name: 'Introduction to Biology',
  courseCode: 'BIO-101',
  workflowState: 'available',
  syllabusBody: '<p>Welcome to <strong>BIO-101</strong>. Weekly labs.</p>',
  termName: 'Fall 2026',
};

describe('course: record rendering', () => {
  it('renders a course overview with the stripped syllabus', () => {
    const text = renderCourseOverview(course);
    expect(text).toContain('Introduction to Biology (BIO-101)');
    expect(text).toContain('Term: Fall 2026');
    expect(text).toContain('Syllabus:');
    expect(text).toContain('Welcome to BIO-101. Weekly labs.');
    expect(text).not.toContain('<strong>');
  });

  it('renders an assignment with meta and stripped description', () => {
    const a: Assignment = {
      id: 1,
      name: 'Lab Report 1',
      description: '<p>Write up the osmosis lab.</p>',
      dueAt: '2026-09-15',
      pointsPossible: 25,
      submissionTypes: ['online_upload'],
    };
    const text = renderAssignment(a);
    expect(text).toContain('Assignment: Lab Report 1');
    expect(text).toContain('Due: 2026-09-15 · Points: 25 · Submit: online_upload');
    expect(text).toContain('Write up the osmosis lab.');
  });

  it('renders a submission with score, flags, and comments', () => {
    const s: Submission = {
      id: 5001,
      userId: 900,
      assignmentId: 1,
      body: '<p>Water moves across the membrane.</p>',
      submittedAt: '2026-09-14',
      workflowState: 'submitted',
      score: 22,
      grade: '22',
      late: true,
      missing: false,
      comments: [{ id: 1, authorName: 'Prof. Ada', comment: 'Good start.', createdAt: '2026-09-15' }],
    };
    const text = renderSubmission(s);
    expect(text).toContain('Submission (user 900) [late]');
    expect(text).toContain('Status: submitted · Score: 22 · Grade: 22');
    expect(text).toContain('Response: Water moves across the membrane.');
    expect(text).toContain('Comment (Prof. Ada): Good start.');
  });

  it('renders a discussion, page, module, and enrollment compactly', () => {
    const d: Discussion = { id: 10, title: 'Week 1', message: '<p>Introduce yourself.</p>', postedAt: '', isAnnouncement: false };
    expect(renderDiscussion(d)).toContain('Discussion: Week 1');
    expect(renderDiscussion(d)).toContain('Introduce yourself.');
    const ann: Discussion = { ...d, isAnnouncement: true, title: 'Welcome' };
    expect(renderDiscussion(ann)).toContain('Announcement: Welcome');

    const p: Page_ = { pageId: 7, url: 'intro', title: 'Week 1 Intro', body: '<p>Read ch. 1.</p>', updatedAt: '' };
    expect(renderPage(p)).toContain('Page: Week 1 Intro');
    expect(renderPage(p)).toContain('Read ch. 1.');

    const m: Module = {
      id: 20,
      name: 'Cells',
      position: 1,
      items: [{ id: 1, title: 'Intro page', type: 'Page', position: 1 }],
    };
    expect(renderModule(m)).toContain('Module: Cells');
    expect(renderModule(m)).toContain('- Intro page [Page]');

    const e: Enrollment = { id: 30, userId: 900, userName: 'Sam Student', type: 'StudentEnrollment', role: 'StudentEnrollment', state: 'active' };
    expect(renderEnrollment(e)).toBe('Sam Student — StudentEnrollment (active)');
  });
});

describe('course: buildCourseContext', () => {
  it('returns empty for no blocks', () => {
    const ctx = buildCourseContext([{ title: 'Assignments', blocks: [] }]);
    expect(ctx).toEqual({ text: '', totalBlocks: 0, includedBlocks: 0, truncated: false });
  });

  it('includes all blocks under section headers when within budget', () => {
    const ctx = buildCourseContext([
      { title: 'Modules', blocks: ['a', 'b'] },
      { title: 'Pages', blocks: ['c'] },
    ]);
    expect(ctx.totalBlocks).toBe(3);
    expect(ctx.includedBlocks).toBe(3);
    expect(ctx.truncated).toBe(false);
    expect(ctx.text).toContain('## Modules');
    expect(ctx.text).toContain('## Pages');
    expect(ctx.text.indexOf('## Modules')).toBeLessThan(ctx.text.indexOf('## Pages'));
  });

  it('windows in order and reports truncation when the budget is exceeded', () => {
    const blocks = ['x'.repeat(30), 'y'.repeat(30), 'z'.repeat(30)];
    const ctx = buildCourseContext([{ title: 'Pages', blocks }], 60);
    expect(ctx.totalBlocks).toBe(3);
    expect(ctx.includedBlocks).toBeLessThan(3);
    expect(ctx.truncated).toBe(true);
    expect(ctx.text).toContain('xxx');
    expect(ctx.text).not.toContain('zzz');
    expect(ctx.text.length).toBeLessThanOrEqual(60);
  });

  it('always includes at least the first block, hard-cutting it if it alone overflows', () => {
    const huge = 'q'.repeat(500);
    const ctx = buildCourseContext([{ title: 'Pages', blocks: [huge, 'next'] }], 50);
    expect(ctx.includedBlocks).toBe(1);
    expect(ctx.truncated).toBe(true);
    expect(ctx.text.length).toBe(50);
    expect(ctx.text.startsWith('## Pages')).toBe(true);
  });

  it('skips empty sections without charging a header', () => {
    const ctx = buildCourseContext([
      { title: 'Empty', blocks: [] },
      { title: 'Pages', blocks: ['a'] },
    ]);
    expect(ctx.text).not.toContain('## Empty');
    expect(ctx.text).toContain('## Pages');
    expect(ctx.includedBlocks).toBe(1);
  });
});

describe('course: contextNote', () => {
  it('is honest about no records', () => {
    expect(contextNote({ text: '', totalBlocks: 0, includedBlocks: 0, truncated: false })).toMatch(/No course records/);
  });
  it('reports full coverage', () => {
    expect(contextNote({ text: 'x', totalBlocks: 3, includedBlocks: 3, truncated: false })).toMatch(/all 3 items/);
  });
  it('reports truncation with the counts', () => {
    expect(contextNote({ text: 'x', totalBlocks: 10, includedBlocks: 4, truncated: true })).toMatch(/4 of 10 items/);
  });
});

describe('course: section builders assemble a real context', () => {
  it('turns typed records into a windowed context end to end', () => {
    const ctx = buildCourseContext([
      courseSection(course),
      moduleSection([{ id: 20, name: 'Cells', position: 1, items: [] }]),
      assignmentSection([{ id: 1, name: 'Lab 1', description: '', dueAt: '', pointsPossible: 25, submissionTypes: [] }]),
      pageSection([{ pageId: 7, url: 'intro', title: 'Intro', body: '', updatedAt: '' }]),
      discussionSection([{ id: 10, title: 'Week 1', message: '', postedAt: '', isAnnouncement: false }]),
      submissionSection([
        { id: 1, userId: 900, assignmentId: 1, body: '', submittedAt: '', workflowState: 'submitted', score: 22, grade: '22', late: false, missing: false, comments: [] },
      ]),
      enrollmentSection([{ id: 30, userId: 900, userName: 'Sam', type: 'StudentEnrollment', role: 'StudentEnrollment', state: 'active' }]),
    ]);
    expect(ctx.totalBlocks).toBe(7);
    expect(ctx.truncated).toBe(false);
    expect(ctx.text).toContain('## Course');
    expect(ctx.text).toContain('Introduction to Biology');
    expect(ctx.text).toContain('## Modules');
    expect(ctx.text).toContain('## Assignments');
    expect(ctx.text).toContain('## Pages');
    expect(ctx.text).toContain('## Discussions');
    expect(ctx.text).toContain('## Submissions');
    expect(ctx.text).toContain('## Enrollments');
  });
});
