import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { FileUpload, type FileUploadProps } from '../components/ui/FileUpload';

type UploadApi = Parameters<NonNullable<FileUploadProps['onUpload']>>[1];

describe('FileUpload', () => {
  it('adds a dropped file and shows it in the list', async () => {
    render(<FileUpload label="Upload" />);

    const dropzone = screen.getByRole('button', { name: 'Upload' });

    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });

    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [file],
        types: ['Files'],
      },
    });

    expect(await screen.findByText('hello.txt')).toBeInTheDocument();
  });

  it('enforces maxFiles and shows an error', async () => {
    render(<FileUpload label="Upload" maxFiles={1} />);

    const dropzone = screen.getByRole('button', { name: 'Upload' });

    const a = new File(['a'], 'a.txt', { type: 'text/plain' });
    const b = new File(['b'], 'b.txt', { type: 'text/plain' });

    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [a],
        types: ['Files'],
      },
    });

    expect(await screen.findByText('a.txt')).toBeInTheDocument();

    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [b],
        types: ['Files'],
      },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(/Max 1 files/i);
  });

  it('validates accept and maxSize and shows an error message', async () => {
    render(
      <FileUpload label="Upload" accept={{ 'image/png': ['.png'] }} maxSize={1} maxFiles={5} />
    );

    const dropzone = screen.getByRole('button', { name: 'Upload' });

    const badType = new File(['x'], 'a.txt', { type: 'text/plain' });
    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [badType],
        types: ['Files'],
      },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(/file type/i);

    const tooBig = new File(['hello'], 'big.png', { type: 'image/png' });
    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [tooBig],
        types: ['Files'],
      },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(/file is larger than/i);
  });

  it('auto-uploads via onUpload and updates status to done', async () => {
    const onUpload = vi.fn((_file: File, api: UploadApi) => {
      api.setProgress(50);
      api.setDone();
      return Promise.resolve();
    });

    render(<FileUpload label="Upload" onUpload={onUpload} />);

    const dropzone = screen.getByRole('button', { name: 'Upload' });

    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [file],
        types: ['Files'],
      },
    });

    expect(await screen.findByText('hello.txt')).toBeInTheDocument();
    expect(await screen.findByText('done')).toBeInTheDocument();
    expect(
      await screen.findByRole('progressbar', { name: /Upload progress for hello\.txt/i })
    ).toBeInTheDocument();
    expect(onUpload).toHaveBeenCalledTimes(1);
  });
});
