const axios = require("axios");

const img_storage_ms = "http://img_storage:11000";

async function get_image_internal_url(user, project, type, img, options = {}) {
  return axios.get(`${img_storage_ms}/image/internal/${user}/${project}/${type}/${img}`, options);
}

async function get_image_public_url(user, project, type, img, options = {}) {
  return axios.get(`${img_storage_ms}/image/public/${user}/${project}/${type}/${img}`, options);
}

async function post_image(user, project, type, file, options = {}) {
  return axios.post(
    `${img_storage_ms}/upload/${user}/${project}/${type}`,
    file,
    options,
  );
}

async function delete_image(user, project, type, img) {
  return axios.delete(`${img_storage_ms}/delete/${user}/${project}/${type}/${img}`);
}

async function copy_image(userId, projectId, fromStage, toStage, fileName) {
  // usa o mesmo serviÃ§o interno (docker network) tal como as outras
  return axios.post(
    `${img_storage_ms}/copy/${userId}/${projectId}/${fromStage}/${toStage}/${fileName}`,
    {}
  );
}

// True when the object can still be read. Reads a single byte: the presigned URL is signed for
// GET, so a HEAD request would be refused even for an existing object.
async function is_object_readable(user, project, type, img, options = {}) {
  try {
    const { data } = await get_image_internal_url(user, project, type, img, options);
    const response = await axios.get(data.url, {
      ...options,
      headers: { Range: "bytes=0-0" },
      responseType: "arraybuffer",
      validateStatus: (status) => status === 200 || status === 206,
    });
    return response.status === 200 || response.status === 206;
  } catch {
    return false;
  }
}

module.exports = { get_image_internal_url, get_image_public_url, post_image, delete_image, copy_image, is_object_readable };