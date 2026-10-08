import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {GradebookTable} from '../instructor-src/gradebook-table';
import type {Gradebook} from '../instructor-src/api';

const statuses = ['missing','not_submitted','no_deadline','ungraded','graded'] as const;
const data:Gradebook = {
  assignments:statuses.map((status,i)=>({
    id:status,title:`Work ${i}`,points:10,
    dueAt:status==='no_deadline'?null:'2026-10-08T12:00:00Z',createdAt:'2026-10-01T12:00:00Z',
  })),
  students:[{
    studentId:'learner',name:'Learner name',
    grades:statuses.map(status=>({
      assignmentId:status,status,score:status==='graded'?0:null,
      feedback:status==='graded'?'Review this explanation.':null,
      submittedAt:status==='graded'||status==='ungraded'?'2026-10-08T11:00:00Z':null,
    })),
    totals:{earned:0,possible:10,gradedCount:1,ungradedCount:1,missingCount:1,notSubmittedCount:1,noDeadlineCount:1},
  }],
  totals:{assignmentCount:5,studentCount:1},
};

for (const owner of [true,false]) {
  test(`gradebook labels and totals for ${owner?'owner':'student'}`,()=>{
    const html=renderToStaticMarkup(<GradebookTable data={data} owner={owner} assignments={[]} review={()=>{}}/>);
    for(const text of ['Overdue','Not submitted','Not submitted · No deadline','Awaiting grade','0 / 10',
      '1 graded · 1 awaiting · 1 overdue · 1 not submitted · 1 no deadline','Review this explanation.']) {
      assert.ok(html.includes(text),text);
    }
    assert.equal((html.match(/>Review<\/button>/g)||[]).length,owner?2:0);
    assert.ok(html.includes(owner?'Learner name':'Your work'));
    assert.ok(!html.includes('Missing'));
  });
}

test('a missing grade entry does not offer review or claim overdue',()=>{
  const incomplete={...data,students:[{...data.students[0],grades:[]}]};
  const html=renderToStaticMarkup(<GradebookTable data={incomplete} owner assignments={[]} review={()=>{}}/>);
  assert.equal((html.match(/Status unavailable/g)||[]).length,5);
  assert.ok(!html.includes('>Review</button>'));
});
