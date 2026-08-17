import api from "@/lib/api";

export interface UploadedImage {
  file_id: string;
  url: string;
  size: number;
  content_type: string;
}

export async function uploadImage(file: File): Promise<UploadedImage> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post<UploadedImage>("/uploads/image", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export interface LinkPreview {
  url: string;
  title: string;
  description?: string | null;
  image?: string | null;
  site_name?: string | null;
}

export async function fetchLinkPreview(url: string): Promise<LinkPreview> {
  const { data } = await api.get<LinkPreview>("/link-preview", { params: { url } });
  return data;
}
