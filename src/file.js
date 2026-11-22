import { extensionOf, EXTENSIONS, TEXT_EXTENSIONS, BINARY_EXTENSIONS } from './workouts/formats.js';
//
// File Handler
//
import { dateToDashString } from './utils.js';

class FileHandler {
    Type = {
        OctetStream: 'application/octet-stream',
        textPlain: 'text/plain',
    }

    constructor(args) {}
    readTextFile(file) {
        const self = this;
        const reader = new FileReader();
        reader.readAsText(file);

        return new Promise((resolve, reject) => {
            reader.onload = function(event) {
                return resolve(reader.result);
            };
            reader.onerror = function(event) {
                return reject(reader.error);
            };
        });
    }
    readBinaryFile(file) {
        const self = this;
        const reader = new FileReader();
        reader.readAsArrayBuffer(file);

        return new Promise((resolve, reject) => {
            reader.onload = function(event) {
                return resolve(reader.result);
            };
            reader.onerror = function(event) {
                return reject(reader.error);
            };
        });
    }
    unsupportedFormat(name) {
        return Promise.reject(new Error(
            `${name} is not a supported workout file. Use one of: ${EXTENSIONS.map(e => '.' + e).join(', ')}.`
        ));
    }
    read(file) {
        const self = this;
        const ext = extensionOf(file.name);
        if(BINARY_EXTENSIONS.includes(ext)) return self.readBinaryFile(file);
        if(TEXT_EXTENSIONS.includes(ext)) return self.readTextFile(file);
        return self.unsupportedFormat(file.name);
    }
    toBlob(buffer, type) {
        const self = this;
        return new Blob([buffer], {type: type ?? self.Type.OctetStream});
    }
    download() {
        const self = this;
        let a = document.createElement('a');
        document.body.appendChild(a);
        a.style = 'display: none';
        return function (buffer, name, type) {
            let url = window.URL.createObjectURL(self.toBlob(buffer, type));
            a.href = url;
            a.download = name;
            a.click();
            window.URL.revokeObjectURL(url);
        };
    };
}

const fileHandler = new FileHandler();

export { fileHandler };
