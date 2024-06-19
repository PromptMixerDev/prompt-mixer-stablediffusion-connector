import * as fs from 'node:fs';
import * as path from 'node:path';

import { config } from './config';

interface RequestBody {
	prompt: string;
	negative_prompt?: string;
	aspect_ratio?: string;
	seed?: number;
	output_format?: string;
	image?: string; // base64
}

interface Completion {
	Content: string | ErrorResponse | null;
	Error?: string;
	TokenUsage?: number;
}

interface ConnectorResponse {
	Completions: Completion[];
	ModelType: string;
}

const mapToResponse = (
	outputs: (string | ErrorResponse)[],
	model: string,
): ConnectorResponse => {
	return {
		Completions: outputs.map((output) => {
			if (typeof output === 'string') {
				return {
					Content: output,
					TokenUsage: undefined,
				};
			}

			return {
				Content: null,
				TokenUsage: undefined,
				Error: output.error,
			};
		}),
		ModelType: model,
	};
};

interface SuccessResponse {
	image: string;
	finish_reason: string;
	seed?: number;
}

interface ErrorConnectorResponse {
	id: string;
	name: string;
	errors: string;
}

interface ErrorResponse {
	error: string;
	model: string;
	usage: undefined;
}

const mapErrorToCompletion = (
	error: ErrorConnectorResponse | Error,
	model: string,
): ErrorResponse => {
	if ('message' in error) {
		return {
			error: error.message,
			model,
			usage: undefined,
		};
	}

	return {
		error: `[${error.name}]: ${error.errors[0]}`,
		model,
		usage: undefined,
	};
};

function encodeImage(imagePath: string): {
	data: string;
	format: string;
	imageName: string;
} {
	const imageExtName = path.extname(imagePath);
	const imageName = path.basename(imagePath);
	const imageBuffer = fs.readFileSync(imagePath);
	return {
		data: Buffer.from(imageBuffer).toString('base64'),
		format: `image/${imageExtName.slice(1)}`,
		imageName,
	};
}

function base64ToBlob(base64: string, contentType: string): Blob {
	const byteCharacters = atob(base64);
	const byteNumbers = new Array(byteCharacters.length);
	for (let i = 0; i < byteCharacters.length; i++) {
		byteNumbers[i] = byteCharacters.charCodeAt(i);
	}
	const byteArray = new Uint8Array(byteNumbers);
	return new Blob([byteArray], { type: contentType });
}

async function main(
	model: string,
	prompts: string[],
	properties: Record<string, unknown>,
	settings: Record<string, unknown>,
) {
	const url = `https://api.stability.ai/v2beta/stable-image/generate/${model}`;

	const total = prompts.length;

	const outputs: Array<string | ErrorResponse> = [];

	try {
		for (let index = 0; index < total; index++) {
			try {
				const userPrompt = prompts[index];
				const imageUrls = extractImageUrls(userPrompt);

				const payload: RequestBody = {
					prompt: userPrompt,
					...properties,
				};

				const formData = new FormData();
				Object.entries(payload).forEach(([key, value]) =>
					formData.append(key, value),
				);

				for (const imageUrl of imageUrls) {
					const { data, format, imageName } = encodeImage(imageUrl);

					formData.append('image', base64ToBlob(data, format), imageName);
					formData.append('mode', properties?.mode as string);
					formData.append('strength', properties?.strength as string);
				}

				const response = await fetch(url, {
					method: 'POST',
					body: formData,
					headers: {
						Authorization: `Bearer ${settings?.['API_KEY']}`,
						Accept: 'application/json',
					},
				});

				if (response.status === 200) {
					const data: SuccessResponse = await response.json();
					console.log('Success data: ', data.finish_reason);

					outputs.push(
						`![${userPrompt}](data:image/${properties?.output_format ?? 'png'};base64,${data.image})`,
					);
				} else {
					const data: ErrorConnectorResponse = await response.json();

					console.log('Error data: ', data);
					const completionWithError = mapErrorToCompletion(data, model);
					outputs.push(completionWithError);
				}
			} catch (error) {
				console.log(error);
				const completionWithError = mapErrorToCompletion(error, model);
				outputs.push(completionWithError);
			}
		}

		return mapToResponse(outputs, model);
	} catch (error) {
		console.error('Error in main function:', error);
		return { Error: error, ModelType: model };
	}
}

function extractImageUrls(prompt: string): string[] {
	const imageExtensions = ['.png', '.jpeg', '.webp'];
	// Updated regex to match both http and local file paths
	const urlRegex =
		/(https?:\/\/[^\s]+|[a-zA-Z]:\\[^:<>"|?\n]*|\/[^:<>"|?\n]*)/g;
	const urls = prompt.match(urlRegex) || [];

	return urls.filter((url) => {
		const extensionIndex = url.lastIndexOf('.');
		if (extensionIndex === -1) {
			// If no extension found, return false.
			return false;
		}
		const extension = url.slice(extensionIndex);
		return imageExtensions.includes(extension.toLowerCase());
	});
}

export { main, config };
