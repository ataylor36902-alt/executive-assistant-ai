export const COURSE_STUDY_ID = 'course-study';

export function resolveStudyExamId({ requestedExamId, upcomingExamId, hasSources, lectureCount }) {
  if (requestedExamId) return requestedExamId;
  if (upcomingExamId) return upcomingExamId;
  return hasSources && !lectureCount ? COURSE_STUDY_ID : 'finals';
}

export function isFinalsStudy({ examId, lectureIds, before }) {
  return examId === 'finals' || (!examId && !lectureIds && !before);
}

export function requiredExamFeaturePlan(feature, finalsMode) {
  return feature === 'advanced' || finalsMode ? 'pro' : 'student';
}