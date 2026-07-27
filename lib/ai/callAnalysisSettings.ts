export type CallAnalysisSettings = {
  aiCallOverviewEnabled?: boolean;
  aiCallCoachingEnabled?: boolean;
} | null | undefined;

export function enabledCallAnalysis(settings: CallAnalysisSettings) {
  return {
    overview: settings?.aiCallOverviewEnabled !== false,
    coaching: settings?.aiCallCoachingEnabled === true,
  };
}
