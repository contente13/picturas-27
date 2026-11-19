import os
import uuid

from PIL import Image

from . import fault_hooks

class Img_HandlerException(Exception):
    def __init__(self, message, error_code = None):
        super().__init__(message)
        self.error_code = error_code

class Img_Handler:
    def __init__(self):
        pass

    def get_img(self, img_path:str) -> Image:
        return Image.open(img_path)
    
    def store_img(self, img: Image, img_path:str) -> None:
        """RNF-FIAB-01: atomic write. The image is saved to a unique temporary file in the
        same directory (same extension, so the format is unchanged) and renamed over the
        target, so a reader never sees a partial file under the final name."""
        directory = os.path.dirname(img_path) or "."
        os.makedirs(directory, exist_ok=True)
        base, ext = os.path.splitext(os.path.basename(img_path))
        tmp = os.path.join(directory, f".{base}.{os.getpid()}.{uuid.uuid4().hex}.tmp{ext}")
        try:
            fault_hooks.store_img(img, tmp, Image.registered_extensions().get(ext.lower()))
            os.replace(tmp, img_path)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
