---
base_model: nielsr/slimsam-77-uniform
library_name: transformers.js
tags:
- slimsam
license: apache-2.0
---

https://huggingface.co/nielsr/slimsam-77-uniform with ONNX weights to be compatible with Transformers.js.

## Usage (Transformers.js)

If you haven't already, you can install the [Transformers.js](https://huggingface.co/docs/transformers.js) JavaScript library from [NPM](https://www.npmjs.com/package/@huggingface/transformers) using:
```bash
npm i @huggingface/transformers
```

**Example:** Perform mask generation with `Xenova/slimsam-77-uniform`.

```js
import { SamModel, AutoProcessor, RawImage } from '@huggingface/transformers';

// Load model and processor
const model = await SamModel.from_pretrained('Xenova/slimsam-77-uniform');
const processor = await AutoProcessor.from_pretrained('Xenova/slimsam-77-uniform');

// Prepare image and input points
const img_url = 'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/corgi.jpg';
const raw_image = await RawImage.read(img_url);
const input_points = [[[340, 250]]];

// Process inputs and perform mask generation
const inputs = await processor(raw_image, { input_points });
const outputs = await model(inputs);

// Post-process masks
const masks = await processor.post_process_masks(outputs.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
console.log(masks);
// [
//   Tensor {
//     dims: [ 1, 3, 410, 614 ],
//     type: 'bool',
//     data: Uint8Array(755220) [ ... ],
//     size: 755220
//   }
// ]
const scores = outputs.iou_scores;
console.log(scores);
// Tensor {
//   dims: [ 1, 1, 3 ],
//   type: 'float32',
//   data: Float32Array(3) [
//     0.8350210189819336,
//     0.9786665439605713,
//     0.8379436731338501
//   ],
//   size: 3
// }
```

You can then visualize the generated mask with:

```js
const image = RawImage.fromTensor(masks[0][0].mul(255));
image.save('mask.png');
```

![image/png](https://cdn-uploads.huggingface.co/production/uploads/61b253b7ac5ecaae3d1efe0c/2vWMNptPh5jJKdLrnUIik.png)

Next, select the channel with the highest IoU score, which in this case is the second (green) channel. Intersecting this with the original image gives us an isolated version of the subject:

![image/gif](https://cdn-uploads.huggingface.co/production/uploads/61b253b7ac5ecaae3d1efe0c/ATwz4cQEZyUwU2BsOTq92.gif)



## Demo

We've also got an online demo, which you can try out [here](https://huggingface.co/spaces/Xenova/segment-anything-web).


<video controls autoplay src="https://cdn-uploads.huggingface.co/production/uploads/61b253b7ac5ecaae3d1efe0c/Y0wAOw6hz9rWpwiuMoz2A.mp4"></video>

---


Note: Having a separate repo for ONNX weights is intended to be a temporary solution until WebML gains more traction. If you would like to make your models web-ready, we recommend converting to ONNX using [🤗 Optimum](https://huggingface.co/docs/optimum/index) and structuring your repo like this one (with ONNX weights located in a subfolder named `onnx`).