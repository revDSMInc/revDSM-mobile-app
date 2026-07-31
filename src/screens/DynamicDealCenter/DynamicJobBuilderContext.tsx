import React, { createContext, useContext, useMemo } from 'react';
import type { JobBuilderConfig, JobState } from '../../utils/dynamic-job-builder/types';
import { computePreviewSnapshot } from '../../utils/dynamic-job-builder/engine/preview-compute';

interface DynamicJobBuilderContextValue {
  config: JobBuilderConfig;
  jobState: JobState;
  previewSnapshot: any;
}

const DynamicJobBuilderContext = createContext<DynamicJobBuilderContextValue | null>(null);

export function useDynamicJobBuilderContext(): DynamicJobBuilderContextValue {
  const ctx = useContext(DynamicJobBuilderContext);
  if (!ctx) throw new Error('useDynamicJobBuilderContext must be used within DynamicJobBuilderProvider');
  return ctx;
}

interface DynamicJobBuilderProviderProps {
  config: JobBuilderConfig;
  jobState: JobState;
  dealCenterData?: any;
  children: React.ReactNode;
}

export function DynamicJobBuilderProvider({
  config,
  jobState,
  dealCenterData,
  children,
}: DynamicJobBuilderProviderProps) {
  const previewSnapshot = useMemo(
    () => computePreviewSnapshot({ config, dealCenterData: dealCenterData || {} }),
    [config, dealCenterData]
  );

  const value = useMemo<DynamicJobBuilderContextValue>(
    () => ({ config, jobState, previewSnapshot }),
    [config, jobState, previewSnapshot]
  );

  return (
    <DynamicJobBuilderContext.Provider value={value}>
      {children}
    </DynamicJobBuilderContext.Provider>
  );
}
