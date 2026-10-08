import type {Assignment, Gradebook} from './api';

export function GradebookTable({data,owner,assignments,review}:{
  data:Gradebook; owner:boolean; assignments:Assignment[];
  review:(assignment:Assignment,studentId?:string)=>void;
}) {
  return <div className="feature-table-wrap"><table className="feature-table">
    <thead><tr><th>{owner?'Student':'Progress'}</th>{data.assignments.map(a=><th key={a.id}>
      {a.title}<div className="small-muted">{a.points} points</div>
      <div className="small-muted">{a.dueAt?`Due ${new Date(a.dueAt).toLocaleString()}`:'No deadline'}</div>
    </th>)}<th>Graded total</th></tr></thead>
    <tbody>{data.students.map(s=><tr key={s.studentId}>
      <td>{owner?s.name:'Your work'}<div className="small-muted">{owner?s.studentId:''}</div></td>
      {data.assignments.map(a=>{
        const grade=s.grades.find(g=>g.assignmentId===a.id);
        const submitted=grade?.status==='graded'||grade?.status==='ungraded';
        const label=grade?.status==='graded'?`${grade.score} / ${a.points}`
          :grade?.status==='ungraded'?'Awaiting grade'
          :grade?.status==='missing'?'Overdue'
          :grade?.status==='no_deadline'?'Not submitted · No deadline'
          :grade?.status==='not_submitted'?'Not submitted':'Status unavailable';
        return <td key={a.id}>
          <span className={`pill ${grade?.status==='missing'?'student':''}`}>{label}</span>
          {grade?.feedback&&<p className="small-muted">{grade.feedback}</p>}
          {owner&&submitted&&<button type="button" className="button subtle small"
            aria-label={`Review ${s.name}'s submission for ${a.title}`}
            data-testid={`button-gradebook-review-${s.studentId}-${a.id}`}
            onClick={()=>{const assignment=assignments.find(item=>item.id===a.id);if(assignment)review(assignment,s.studentId)}}>
            Review
          </button>}
        </td>;
      })}
      <td>{s.totals.earned} / {s.totals.possible}<div className="small-muted">
        {s.totals.gradedCount} graded · {s.totals.ungradedCount} awaiting · {s.totals.missingCount} overdue · {s.totals.notSubmittedCount} not submitted · {s.totals.noDeadlineCount} no deadline
      </div></td>
    </tr>)}</tbody>
  </table></div>;
}
