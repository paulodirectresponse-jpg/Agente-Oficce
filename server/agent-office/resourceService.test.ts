import { describe, expect, it } from 'vitest';
import { extractTextContent, resourceKind, sanitizeUploadName } from './resourceService.js';

describe('resourceService helpers',()=>{
  it('sanitizes traversal and reserved upload characters',()=>{expect(sanitizeUploadName('../bad:name?.txt')).toBe('bad_name_.txt')});
  it('classifies multimodal and unknown resources',()=>{expect(resourceKind('image/png','a.png')).toBe('image');expect(resourceKind('video/mp4','a.mp4')).toBe('video');expect(resourceKind('application/pdf','a.pdf')).toBe('document');expect(resourceKind('application/octet-stream','a.bin')).toBe('other')});
  it('extracts text without decoding binary media',()=>{expect(extractTextContent(Buffer.from('hello'),'text/plain','a.txt')).toBe('hello');expect(extractTextContent(Buffer.from([0,1,2]),'image/png','a.png')).toBe('')});
});
