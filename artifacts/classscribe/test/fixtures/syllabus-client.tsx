import { useMutation, useQuery } from "@tanstack/react-query";

// Only transport is substituted: the tests exercise real React state and query invalidation.
export const state: {
  scenario: any;
  saved: boolean;
  reads: number;
  confirmations: any[];
  toasts: any[];
} = { scenario: null, saved: false, reads: 0, confirmations: [], toasts: [] };

export const getGetSyllabusQueryKey = (id: string) => ["syllabus", id];
export const getListCoursesQueryKey = () => ["courses"];
export const getGetDashboardGlanceQueryKey = () => ["dashboard"];
export const getListSyllabusAssignmentsQueryKey = () => ["assignments"];
export const getListSyllabusModulesQueryKey = () => ["modules"];

export function useGetSyllabus(id: string) {
  return useQuery({
    queryKey: getGetSyllabusQueryKey(id),
    queryFn: async () => {
      state.reads++;
      return structuredClone(state.saved ? state.scenario.reloaded : {
        courseId: id, filename: null, uploadedAt: null, dates: [], assignments: [], modules: [],
      });
    },
  });
}
export const useListCourses = () => ({ data: [{
  id: state.scenario.reloaded.courseId, ...state.scenario.input,
}] });
export const usePreviewSyllabus = () => useMutation({
  mutationFn: async () => {
    const input = state.scenario.input;
    return structuredClone({
      proposedName: input.name, proposedSubject: input.subject, proposedTerm: input.term,
      dates: input.selectedDates, assignments: input.selectedAssignments, modules: input.selectedModules,
    });
  },
});
export const useConfirmSyllabus = () => useMutation({
  mutationFn: async (payload: any) => {
    state.confirmations.push(structuredClone(payload));
    state.saved = true;
    return structuredClone(state.scenario.confirmed);
  },
});
export const useSetSyllabusAssignmentCompletion = () => useMutation({
  mutationFn: async () => { throw new Error("Completion is outside this test"); },
});
