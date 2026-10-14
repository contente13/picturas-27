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
  // usa o mesmo serviço interno (docker network) tal como as outras
  return axios.post(
    `${img_storage_ms}/copy/${userId}/${projectId}/${fromStage}/${toStage}/${fileName}`,
    {}
  );
}

module.exports = { get_image_internal_url, get_image_public_url, post_image, delete_image, copy_image };
