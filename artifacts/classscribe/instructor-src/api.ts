export type Course = {id:string;name:string;subject?:string;term?:string;role:'instructor'|'student';memberCount?:number};
export type Announcement = {id:string;title:string;body:string;createdAt:string};
export type Material = {id:string;title:string;url:string;description?:string;filename?:string|null;mimeType?:string|null;sizeBytes?:number|null;createdAt:string};
export type Submission = {id:string;studentId:string;studentName?:string;text:string;score:number|null;feedback?:string|null;submittedAt:string;filename?:string|null;mimeType?:string|null;sizeBytes?:number|null};
export type Assignment = {id:string;title:string;instructions:string;dueAt:string|null;points:number;filename?:string|null;mimeType?:string|null;sizeBytes?:number|null;createdAt:string;mySubmission?:Submission|null};
export type CourseDetail = {course:Course;role:'instructor'|'student';roster?:Array<{id?:string;userId?:string;studentId?:string;name?:string;email?:string;role?:string}>;announcements:Announcement[];materials:Material[];assignments:Assignment[]};
export type EduAccess = {canCreateCourse:boolean;canJoinLicensedCourse:boolean;needsCredentials:boolean;canManageSchool:boolean};
export type {EduInstructor, EduSchool, EduExpiryWarning} from '@workspace/api-client-react';
export type Gradebook = import('@workspace/api-client-react').EduGradebook;
export type Topic = {id:string;title:string;body:string;creatorId:string;createdAt:string;updatedAt:string;lockedAt:string|null};
export type Reply = {id:string;topicId:string;body:string;creatorId:string;createdAt:string;updatedAt:string};
export type Group = {id:string;name:string;description:string|null;createdAt:string;memberIds:string[]};
export type Lecture = {id:string;title:string;professor:string;lectureDate:string;transcriptionStatus:string;transcript:string|null;audioMimeType:string|null;audioFilename:string|null;groupIds:string[]};
export type Source = {id:string;title:string;kind:'link'|'upload';url:string|null;description:string|null;filename:string|null;mimeType:string|null;sizeBytes:number|null;visibility:'private'|'groups'|'class';groupIds?:string[]};

export class EduError extends Error {
  status:number;
  code?:string;
  constructor(message:string,status:number,code?:string){super(message);this.status=status;this.code=code;}
}
export async function edu<T>(path:string, getToken:()=>Promise<string|null>, method='GET', body?:unknown):Promise<T>{
  const token=await getToken();
  const response=await fetch(`/api/edu${path}`,{
    method,credentials:'include',
    headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},
    ...(body!==undefined?{body:JSON.stringify(body)}:{})
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new EduError(typeof payload.error==='string'?payload.error:`Request failed (${response.status}).`,response.status,typeof payload.code==='string'?payload.code:undefined);
  return payload as T;
}
export async function eduBlob(path:string,getToken:()=>Promise<string|null>):Promise<Blob>{
  const token=await getToken();
  const response=await fetch(`/api/edu${path}`,{
    credentials:'include',
    headers:token?{Authorization:`Bearer ${token}`}:{}
  });
  if(!response.ok){const payload=await response.json().catch(()=>({}));throw new EduError(typeof payload.error==='string'?payload.error:`Download failed (${response.status}).`,response.status,payload.code)}
  return response.blob();
}
export function fileBase64(file:Blob):Promise<string>{
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('Could not read the file.'));reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.readAsDataURL(file)});
}
