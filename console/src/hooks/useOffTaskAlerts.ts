import { useState, useCallback } from 'react';
import { ClassroomLayout } from '../types';
import { DEFAULT_OFFTASK_KEYWORDS } from '../components/Toolbar/AlertSettingsModal';
import { LayoutStorage } from '../services/layoutStorage';

export function useOffTaskAlerts(setLayout: React.Dispatch<React.SetStateAction<ClassroomLayout>>) {
  const [alertsEnabled, setAlertsEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('gridsight_alerts_enabled');
      if (saved !== null) return saved === 'true';
    } catch {}
    return true;
  });

  const [offTaskKeywords, setOffTaskKeywords] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('gridsight_offtask_keywords');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return DEFAULT_OFFTASK_KEYWORDS;
  });

  const [filterOnlyOffTask, setFilterOnlyOffTask] = useState(false);

  const isOffTaskMatch = useCallback((title?: string, kws: string[] = offTaskKeywords): boolean => {
    if (!title) return false;
    const lower = title.toLowerCase();
    return kws.some((k) => k.trim() && lower.includes(k.trim().toLowerCase()));
  }, [offTaskKeywords]);

  const handleUpdateKeywords = useCallback((kws: string[]) => {
    setOffTaskKeywords(kws);
    setLayout((prev) => {
      const updated = { ...prev, offTaskKeywords: kws };
      LayoutStorage.saveLayout(updated);
      return updated;
    });
    try {
      localStorage.setItem('gridsight_offtask_keywords', JSON.stringify(kws));
    } catch {}
  }, [setLayout]);

  const handleToggleAlertsEnabled = useCallback((enabled: boolean) => {
    setAlertsEnabled(enabled);
    try {
      localStorage.setItem('gridsight_alerts_enabled', enabled.toString());
    } catch {}
  }, []);

  return {
    alertsEnabled,
    offTaskKeywords,
    setOffTaskKeywords,
    filterOnlyOffTask,
    setFilterOnlyOffTask,
    isOffTaskMatch,
    handleUpdateKeywords,
    handleToggleAlertsEnabled,
  };
}
