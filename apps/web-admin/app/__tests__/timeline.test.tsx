import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Timeline, type TimelineEvent } from '../components/ui/Timeline';

const mockEvents: TimelineEvent[] = [
  {
    id: '1',
    timestamp: new Date('2026-01-11T14:30:00'),
    title: 'Product updated',
    description: 'Updated price from $10 to $15',
    status: 'success',
  },
  {
    id: '2',
    timestamp: new Date('2026-01-11T10:00:00'),
    title: 'Sync started',
    description: 'Initial sync triggered',
    status: 'info',
  },
  {
    id: '3',
    timestamp: new Date('2026-01-10T09:00:00'),
    title: 'Product created',
    description: 'New product added to catalog',
    status: 'neutral',
  },
];

describe('Timeline', () => {
  it('renders timeline events', () => {
    render(<Timeline events={mockEvents} relativeTime={false} timeFormat="HH:mm" />);

    expect(screen.getByText('Product updated')).toBeInTheDocument();
    expect(screen.getByText('Sync started')).toBeInTheDocument();
    expect(screen.getByText('Product created')).toBeInTheDocument();
  });

  it('groups events by day with headers', () => {
    render(
      <Timeline events={mockEvents} showGroupHeaders relativeTime={false} timeFormat="HH:mm" />
    );

    // Today and Yesterday headers should appear
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Yesterday')).toBeInTheDocument();
  });

  it('displays relative timestamps when relativeTime is true', () => {
    const recentEvent: TimelineEvent = {
      id: 'recent',
      timestamp: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
      title: 'Recent event',
      status: 'info',
    };

    render(<Timeline events={[recentEvent]} relativeTime />);

    // Should show relative time like "5 minutes ago" or "less than a minute ago"
    expect(screen.getByText(/ago/i)).toBeInTheDocument();
  });

  it('shows loading state when loading is true and no events', () => {
    render(<Timeline events={[]} loading loadingState={<div>Loading timeline…</div>} />);

    expect(screen.getByText('Loading timeline…')).toBeInTheDocument();
  });

  it('shows empty state when no events are provided', () => {
    render(<Timeline events={[]} emptyState={<div>No activity found</div>} />);

    expect(screen.getByText('No activity found')).toBeInTheDocument();
  });

  it('expands event details when clicked', async () => {
    const user = userEvent.setup();

    render(<Timeline events={mockEvents} expandable relativeTime={false} />);

    // Description should not be visible initially
    expect(screen.queryByText('Updated price from $10 to $15')).not.toBeInTheDocument();

    // Click on the event to expand
    const eventItem = screen.getByText('Product updated').closest('[role="button"]');
    expect(eventItem).toBeInTheDocument();

    await user.click(eventItem!);

    // Description should now be visible
    expect(screen.getByText('Updated price from $10 to $15')).toBeInTheDocument();
  });

  it('calls loadMore when scrolled near the end', () => {
    const loadMore = vi.fn();

    const { container } = render(<Timeline events={mockEvents} loadMore={loadMore} hasMore />);

    const scroller = container.querySelector('[role="feed"]');
    expect(scroller).toBeInTheDocument();

    // Simulate scroll near end
    Object.defineProperty(scroller, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 100, configurable: true });
    Object.defineProperty(scroller, 'scrollTop', {
      value: 850,
      configurable: true,
      writable: true,
    });

    scroller!.dispatchEvent(new Event('scroll', { bubbles: true }));

    expect(loadMore).toHaveBeenCalled();
  });

  it('displays metadata in expanded state', async () => {
    const user = userEvent.setup();

    const eventWithMetadata: TimelineEvent = {
      id: 'meta',
      timestamp: new Date(),
      title: 'Event with metadata',
      metadata: { jobId: '12345', duration: '5s' },
      status: 'success',
    };

    render(<Timeline events={[eventWithMetadata]} expandable />);

    const eventItem = screen.getByText('Event with metadata').closest('[role="button"]');
    await user.click(eventItem!);

    expect(screen.getByText('jobId:')).toBeInTheDocument();
    expect(screen.getByText('12345')).toBeInTheDocument();
  });

  it('renders horizontal orientation', () => {
    const { container } = render(
      <Timeline events={mockEvents} orientation="horizontal" relativeTime={false} />
    );

    // Should have horizontal flex container
    const horizontalContainer = container.querySelector('.flex.items-start.gap-4');
    expect(horizontalContainer).toBeInTheDocument();
  });

  it('sorts events by timestamp (most recent first)', () => {
    render(<Timeline events={mockEvents} showGroupHeaders={false} relativeTime={false} />);

    const titles = screen.getAllByText(/Product|Sync/).map((el) => el.textContent);

    // Most recent event should appear first
    expect(titles[0]).toBe('Product updated');
  });
});
