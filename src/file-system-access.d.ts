/**
 * TypeScript declarations for File System Access API members used by this
 * extension. Chromium implements these APIs; some TypeScript DOM libraries
 * do not yet include their declarations.
 */
interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface FileSystemHandle {
  queryPermission(
    descriptor?: FileSystemHandlePermissionDescriptor,
  ): Promise<PermissionState>;
  requestPermission?(
    descriptor?: FileSystemHandlePermissionDescriptor,
  ): Promise<PermissionState>;
}

interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
}

interface Window {
  showDirectoryPicker(options?: {
    id?: string;
    startIn?: string | FileSystemHandle;
    mode?: 'read' | 'readwrite';
  }): Promise<FileSystemDirectoryHandle>;
}