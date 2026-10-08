// Hand-entered scores and server analyses, shared by the web and native UI tests.
export const course = { id: 'biology', code: 'BIO', name: 'Biology' };
export const item = (id, type, earned, possible = 100) => ({ id, title: id, type, earned, possible, date: null });
export function entry(items = [], byType = [], weights = null, courseId = course.id) {
  return { courseId, gradebook: { courseId, items, weights, credits: 3, version: 1, finalPercent: null }, analysis: { byType, averagePercent: byType[0]?.averagePercent ?? null, isEstimate: true } };
}
export const result = (...courses) => ({ courses, summary: { estimatedGpa: null, countedCredits: 0 } });
export const category = (type, averagePercent) => ({ type, averagePercent });
export const cases = [
  { name: 'no scores', row: entry(), includes: [/returned/i], excludes: [/Rework|Revisit|missed step|Start with|scored average/] },
  { name: 'lowest scored category and its item', row: entry(
    [item('Weak quiz', 'quiz', 40), item('Strong test', 'test', 90)],
    [category('test', 90), category('quiz', 40)]),
    includes: [/Quizzes/, /Weak quiz/, /40(?:\.0)?%/], excludes: [/Rework Strong test|Revisit “BIO · Strong test/] },
  { name: 'points determine category average, not a single tiny item', row: entry(
    [item('Tiny quiz', 'quiz', 0, 1), item('Large quiz', 'quiz', 100), item('Weak test', 'test', 40)],
    [category('quiz', 100 / 101 * 100), category('test', 40)]),
    includes: [/Tests/, /Weak test/], excludes: [/Rework Tiny quiz|Revisit “BIO · Tiny quiz/] },
  { name: 'weighted categories exclude zero-weight work', row: entry(
    [item('Zero weight quiz', 'quiz', 0), item('Weighted test', 'test', 70)],
    [category('quiz', 0), category('test', 70)], { assignment: 0, project: 0, quiz: 0, test: 100 }),
    includes: [/Tests/, /Weighted test/, /100(?:\.0)?%.*(?:weight|course)/], excludes: [/Zero weight quiz/, /Quizzes feedback|Start with Quizzes/] },
  { name: 'nonzero weights retain the weakest-category priority and its actual weight', row: entry(
    [item('Weighted quiz', 'quiz', 60), item('Weighted exam', 'test', 80)],
    [category('test', 80), category('quiz', 60)], { assignment: 0, project: 0, quiz: 20, test: 80 }),
    includes: [/Quizzes/, /Weighted quiz/, /20(?:\.0)?%.*(?:weight|course)/], excludes: [/Rework Weighted exam|Revisit “BIO · Weighted exam/] },
  { name: 'zero-weight work cannot become fallback advice', row: entry(
    [item('Ignored work', 'quiz', 0)], [category('quiz', 0)], { assignment: 0, project: 0, quiz: 0, test: 100 }),
    includes: [/review|Review/], excludes: [/Ignored work/, /missed step|Start with|scored average/] },
  { name: 'pending scores are not zeros', row: entry(
    [item('Pending exam', 'test', null), item('Returned quiz', 'quiz', 80)],
    [category('test', null), category('quiz', 80)]),
    includes: [/Quizzes/, /Returned quiz/, /1 saved.*unscored|1 saved item is.*unscored/], excludes: [/Pending exam/, /Tests feedback|Start with Tests/] },
  { name: 'only pending work', row: entry([item('Not returned', 'test', null)], [category('test', null)]),
    includes: [/returned/i], excludes: [/Not returned/, /missed step|Start with|scored average/] },
  { name: 'all perfect', row: entry(
    [item('Perfect quiz', 'quiz', 100)], [category('quiz', 100)]),
    includes: [/strong|what worked/], excludes: [/missed|Start with|scored average|category above/] },
  { name: 'zero is a real entered score', row: entry(
    [item('Zero score test', 'test', 0)], [category('test', 0)]),
    includes: [/Tests/, /Zero score test/, /0(?:\.0)?%/], excludes: [/first score|Add a returned|Enter a score from/] },
];
