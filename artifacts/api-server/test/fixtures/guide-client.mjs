export const getGetStudyGuideQueryKey = id => ["getStudyGuide", id];
export const useGetStudyGuide = () => ({
  data: globalThis.__studyGuideTestResponse,
  isPending: false,
  isError: false,
});
export const useGenerateStudyGuide = () => ({ isPending: false });