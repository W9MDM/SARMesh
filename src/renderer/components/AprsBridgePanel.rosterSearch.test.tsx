import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AprsTrackedClient } from '@/shared/aprs-types';
import { DEFAULT_APRS_SETTINGS, IDLE_APRS_STATUS } from '@/shared/aprs-types';

const roster: AprsTrackedClient[] = [
  {
    nodeId: 0xa1b2c3d4,
    callsign: 'TEAM1',
    team: 'Alpha',
    trackerType: 'ground-team',
    symbolTable: '/',
    symbolCode: '[',
    enabled: true,
  },
  {
    nodeId: 0x0000beef,
    callsign: 'K9UNIT',
    team: 'Bravo',
    trackerType: 'k9-team',
    symbolTable: '/',
    symbolCode: 'p',
    enabled: true,
  },
  {
    nodeId: 0x00001234,
    callsign: 'UTV3',
    team: 'Charlie',
    trackerType: 'utv',
    symbolTable: '/',
    symbolCode: 'j',
    enabled: false,
  },
];

vi.mock('../hooks/useAprsBridge', () => ({
  useAprsBridge: () => ({
    status: IDLE_APRS_STATUS,
    settings: DEFAULT_APRS_SETTINGS,
    roster,
    recent: [],
    error: null,
    busy: false,
    start: vi.fn(),
    stop: vi.fn(),
    saveSettings: vi.fn(),
    upsertClient: vi.fn(),
    removeClient: vi.fn(),
    sendTestBeacon: vi.fn(),
  }),
}));

const { AprsBridgePanel } = await import('./AprsBridgePanel');

function search(): HTMLElement {
  return screen.getByRole('searchbox', { name: 'Search tracked radios' });
}

describe('AprsBridgePanel roster search', () => {
  beforeEach(() => {
    render(<AprsBridgePanel />);
  });

  it('shows the whole roster before anything is typed', () => {
    expect(screen.getByDisplayValue('TEAM1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('K9UNIT')).toBeInTheDocument();
    expect(screen.getByDisplayValue('UTV3')).toBeInTheDocument();
  });

  it('lists the roster alphabetically, not in the order it was built', () => {
    const callsigns = screen
      .getAllByRole('textbox')
      .map((input) => (input as HTMLInputElement).value)
      .filter((value) => ['TEAM1', 'K9UNIT', 'UTV3'].includes(value));
    expect(callsigns).toEqual(['K9UNIT', 'TEAM1', 'UTV3']);
  });

  it('filters by callsign', () => {
    fireEvent.change(search(), { target: { value: 'k9u' } });
    expect(screen.getByDisplayValue('K9UNIT')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('TEAM1')).not.toBeInTheDocument();
  });

  it('filters by team, which is how a leader actually looks a unit up', () => {
    fireEvent.change(search(), { target: { value: 'charlie' } });
    expect(screen.getByDisplayValue('UTV3')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('K9UNIT')).not.toBeInTheDocument();
  });

  it('filters by the displayed node id', () => {
    fireEvent.change(search(), { target: { value: 'beef' } });
    expect(screen.getByDisplayValue('K9UNIT')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('TEAM1')).not.toBeInTheDocument();
  });

  it('filters by tracker type label', () => {
    fireEvent.change(search(), { target: { value: 'K9' } });
    expect(screen.getByDisplayValue('K9UNIT')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('UTV3')).not.toBeInTheDocument();
  });

  it('ignores case and surrounding whitespace', () => {
    fireEvent.change(search(), { target: { value: '  TeAm1  ' } });
    expect(screen.getByDisplayValue('TEAM1')).toBeInTheDocument();
  });

  it('says so when nothing matches, rather than showing an empty table', () => {
    fireEvent.change(search(), { target: { value: 'zulu' } });
    expect(screen.getByText('No tracked radio matches “zulu”.')).toBeInTheDocument();
  });

  it('restores the full roster when the box is cleared', () => {
    fireEvent.change(search(), { target: { value: 'zulu' } });
    fireEvent.change(search(), { target: { value: '' } });
    expect(screen.getByDisplayValue('TEAM1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('K9UNIT')).toBeInTheDocument();
    expect(screen.getByDisplayValue('UTV3')).toBeInTheDocument();
  });
});
