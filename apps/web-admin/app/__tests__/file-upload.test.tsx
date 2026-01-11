import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { FileUpload } from '../components/ui/FileUpload';

describe('FileUpload', () => {
  it('adds a dropped file and shows it in the list', async () => {
    render(<FileUpload label="Upload" />);

    const dropzone = screen.getByText('Drag & drop files').closest('[role="presentation"]');
    expect(dropzone).toBeTruthy();

    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });

    fireEvent.drop(dropzone!, {
      dataTransfer: {
        files: [file],
        types: ['Files'],
      },
    });

    expect(await screen.findByText('hello.txt')).toBeInTheDocument();
  });

  it('enforces maxFiles and shows an error', async () => {
    render(<FileUpload label="Upload" maxFiles={1} />);

    const dropzone = screen.getByText('Drag & drop files').closest('[role="presentation"]');
    expect(dropzone).toBeTruthy();

    const a = new File(['a'], 'a.txt', { type: 'text/plain' });
    const b = new File(['b'], 'b.txt', { type: 'text/plain' });

    fireEvent.drop(dropzone!, {
      dataTransfer: {
        files: [a],
        types: ['Files'],
      },
    });

    expect(await screen.findByText('a.txt')).toBeInTheDocument();

    fireEvent.drop(dropzone!, {
      dataTransfer: {
        files: [b],
        types: ['Files'],
      },
    });

    expect(await screen.findByText(/Max 1 files/i)).toBeInTheDocument();
  });
});
