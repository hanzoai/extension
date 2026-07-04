import { describe, it, expect } from 'vitest';
import {
  parseCourse,
  parseCourses,
  parseAssignment,
  parseAssignments,
  parseSubmission,
  parseSubmissions,
  parseDiscussions,
  parsePage,
  parsePages,
  parseModules,
  parseEnrollments,
} from '../src/canvas-api.js';

// A realistic Canvas course detail payload (trimmed to fields we surface).
const courseFixture = {
  id: 370663,
  name: 'Introduction to Biology',
  course_code: 'BIO-101',
  workflow_state: 'available',
  syllabus_body: '<p>Welcome to <strong>BIO-101</strong>.</p>',
  term: { id: 5, name: 'Fall 2026' },
};

describe('parse: course', () => {
  it('reads name, code, state, syllabus, and term name', () => {
    const c = parseCourse(courseFixture);
    expect(c.id).toBe(370663);
    expect(c.name).toBe('Introduction to Biology');
    expect(c.courseCode).toBe('BIO-101');
    expect(c.workflowState).toBe('available');
    expect(c.syllabusBody).toContain('<strong>BIO-101</strong>');
    expect(c.termName).toBe('Fall 2026');
  });
  it('normalizes a bare array and drops rows without an id', () => {
    const rows = parseCourses([courseFixture, { name: 'no id' }, { id: 0, name: 'bad' }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].courseCode).toBe('BIO-101');
  });
  it('reads a wrapped { courses } shape and defaults a missing term', () => {
    const rows = parseCourses({ courses: [{ id: 2, name: 'Annex' }] });
    expect(rows[0].termName).toBe('');
    expect(rows[0].syllabusBody).toBe('');
  });
});

describe('parse: assignments', () => {
  it('reads name, description, due date, points, and submission types', () => {
    const a = parseAssignment({
      id: 1,
      name: 'Lab Report 1',
      description: '<p>Write up the osmosis lab.</p>',
      due_at: '2026-09-15T23:59:00Z',
      points_possible: 25,
      submission_types: ['online_text_entry', 'online_upload'],
    });
    expect(a).toEqual({
      id: 1,
      name: 'Lab Report 1',
      description: '<p>Write up the osmosis lab.</p>',
      dueAt: '2026-09-15T23:59:00Z',
      pointsPossible: 25,
      submissionTypes: ['online_text_entry', 'online_upload'],
    });
  });
  it('parses an array and drops idless rows', () => {
    const rows = parseAssignments([{ id: 1, name: 'A' }, { name: 'no id' }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].submissionTypes).toEqual([]);
  });
});

describe('parse: submissions', () => {
  const submissionFixture = {
    id: 5001,
    user_id: 900,
    assignment_id: 1,
    body: '<p>Osmosis moves water across a membrane.</p>',
    submitted_at: '2026-09-14T10:00:00Z',
    workflow_state: 'submitted',
    score: 22,
    grade: '22',
    late: true,
    missing: false,
    submission_comments: [
      { id: 1, author_name: 'Prof. Ada', comment: 'Good start.', created_at: '2026-09-15T09:00:00Z' },
    ],
  };

  it('reads score, grade, flags, body, and the comment thread', () => {
    const s = parseSubmission(submissionFixture);
    expect(s.userId).toBe(900);
    expect(s.workflowState).toBe('submitted');
    expect(s.score).toBe(22);
    expect(s.grade).toBe('22');
    expect(s.late).toBe(true);
    expect(s.missing).toBe(false);
    expect(s.body).toContain('Osmosis');
    expect(s.comments).toHaveLength(1);
    expect(s.comments[0].authorName).toBe('Prof. Ada');
    expect(s.comments[0].comment).toBe('Good start.');
  });

  it('treats a null score/grade as null/empty and no comments as []', () => {
    const s = parseSubmission({ id: 1, user_id: 2, score: null, grade: null, workflow_state: 'unsubmitted' });
    expect(s.score).toBeNull();
    expect(s.grade).toBe('');
    expect(s.comments).toEqual([]);
  });

  it('keeps a row that has a user id even without a submission id', () => {
    const rows = parseSubmissions([{ user_id: 900, workflow_state: 'unsubmitted' }, {}]);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(900);
  });
});

describe('parse: discussions', () => {
  it('reads title, message, and the announcement flag', () => {
    const rows = parseDiscussions([
      { id: 10, title: 'Week 1 discussion', message: '<p>Introduce yourself.</p>', posted_at: '2026-09-01T00:00:00Z' },
      { id: 11, title: 'Welcome', message: '<p>Hi all</p>', is_announcement: true },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].title).toBe('Week 1 discussion');
    expect(rows[0].isAnnouncement).toBe(false);
    expect(rows[1].isAnnouncement).toBe(true);
  });
});

describe('parse: pages', () => {
  it('reads a page detail with its body', () => {
    const p = parsePage({ page_id: 7, url: 'week-1-intro', title: 'Week 1 Intro', body: '<p>Read chapter 1.</p>', updated_at: '2026-09-01T00:00:00Z' });
    expect(p).toEqual({ pageId: 7, url: 'week-1-intro', title: 'Week 1 Intro', body: '<p>Read chapter 1.</p>', updatedAt: '2026-09-01T00:00:00Z' });
  });
  it('keeps a list row with a url even without a page_id', () => {
    const rows = parsePages([{ url: 'syllabus', title: 'Syllabus' }, { title: 'no url or id' }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].url).toBe('syllabus');
  });
});

describe('parse: modules', () => {
  it('reads modules with inlined items', () => {
    const mods = parseModules([
      {
        id: 20,
        name: 'Cells',
        position: 1,
        items: [
          { id: 1, title: 'Intro page', type: 'Page', position: 1 },
          { id: 2, title: 'Lab Report 1', type: 'Assignment', position: 2 },
        ],
      },
    ]);
    expect(mods[0].name).toBe('Cells');
    expect(mods[0].items).toHaveLength(2);
    expect(mods[0].items[1]).toEqual({ id: 2, title: 'Lab Report 1', type: 'Assignment', position: 2 });
  });
  it('tolerates a module with no items', () => {
    expect(parseModules([{ id: 1, name: 'Empty' }])[0].items).toEqual([]);
  });
});

describe('parse: enrollments', () => {
  it('reads the person, role, type, and state', () => {
    const rows = parseEnrollments([
      { id: 30, user_id: 900, user: { name: 'Sam Student' }, type: 'StudentEnrollment', role: 'StudentEnrollment', enrollment_state: 'active' },
    ]);
    expect(rows[0]).toEqual({
      id: 30,
      userId: 900,
      userName: 'Sam Student',
      type: 'StudentEnrollment',
      role: 'StudentEnrollment',
      state: 'active',
    });
  });
});
