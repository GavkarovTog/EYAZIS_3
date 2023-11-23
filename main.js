const natural = require("natural");
const tf = require('@tensorflow/tfjs-node');
const { removeStopwords, eng, rus } = require("stopword");
const { processFolder } = require("./utils/getTrainingData");
const { saveToJSON } = require('./utils/saveToFile');
const { loadFromJSON } = require('./utils/loadToFile');
const LanguageDetect = require('languagedetect');


class Tokenizer {
    constructor(pattern) {
        this.pattern = new RegExp(pattern);
    }

    tokenize(toTokenize) {
        let tokens = [];

        for (let match of toTokenize.matchAll(this.pattern)) {
            tokens.push(match[0]);
        }

        return tokens;
    }
}

class SentenceExtraction {
    constructor() {
        this.languageModels = {};
    }

    // documents:
    // {
    //    "ru": <Text>[],
    //    "eng": <Text>[]
    // }
    referate(documents) {
        let sentenceTokenizer = new natural.SentenceTokenizer();
        let referates = [];

        for (let language in documents) {
            let tokenizer = null;

            let tfs = [];
            let tfs_maxes = [];

            let stopwordsLanguage = null;
            let stemmer = null;

            if (language == "ru") {
                tokenizer = new Tokenizer(/[а-яА-Я]+/g);
                stopwordsLanguage = rus;
                stemmer = natural.PorterStemmer;
            } else {
                tokenizer = new Tokenizer(/[a-zA-Z]+/g)
                stopwordsLanguage = eng;
                stemmer = natural.PorterStemmerRu;
            }

            let df = {};
            for (let document of documents[language]) {
                let tf = {};

                let nonProcessedWords = tokenizer.tokenize(document);
                let words = removeStopwords(nonProcessedWords, stopwordsLanguage);
                // for (let word of words) {
                //     console.log(word + " ");
                // }

                let dfCounted = [];
                for (let word of words) {
                    let stemmedWord = stemmer.stem(word);

                    tf[stemmedWord] = (tf[stemmedWord] || 0) + 1

                    if (!dfCounted.includes(stemmedWord)) {
                        dfCounted.push(stemmedWord);
                        df[stemmedWord] = (df[stemmedWord] || 0) + 1;
                    }
                }

                let maxFreq = null;
                for (let word in tf) {
                    if (maxFreq == null || tf[word] > maxFreq) {
                        maxFreq = tf[word];
                    }
                }

                tfs.push(tf);
                tfs_maxes.push(maxFreq);
            }

            let counter = 0;
            for (let document of documents[language]) {
                let tf = tfs[counter];
                let tf_max = tfs_maxes[counter];

                let sentences = sentenceTokenizer.tokenize(document);

                let ratings = [];
                for (let i = 0; i < sentences.length; i++) {
                    let currentSentence = sentences[i];
                    let nonProcessedWords = tokenizer.tokenize(currentSentence);
                    let words = removeStopwords(nonProcessedWords, stopwordsLanguage);

                    let sentenceTf = {};
                    for (let word of words) {
                        let stemmedWord = stemmer.stem(word);

                        sentenceTf[stemmedWord] = (sentenceTf[stemmedWord] || 0) + 1;
                    }

                    let sentenceRating = 0.0;
                    for (let word in sentenceTf) {
                        let stemmedWord = stemmer.stem(word);
                        // console.log(`sentenceTf:  ${sentenceTf[stemmedWord]}`);
                        // console.log(`tf: ${tf[stemmedWord]}`);
                        // console.log(`df: ${df[stemmedWord]}`);
                        // console.log(`tf_max: ${tf_max}`);
                        sentenceRating += (sentenceTf[stemmedWord] || 0) * 0.5 * (1 + (tf[stemmedWord] || 0) / tf_max) * Math.log(documents[language].length / (df[stemmedWord] || 1));
                    }

                    ratings.push({
                        "position": i,
                        "rating": sentenceRating,
                        "sentence": currentSentence
                    });
                }

                ratings.sort((a, b) => b.rating - a.rating);
                let toRefer = ratings.slice(0, Math.min(10, ratings.length));

                toRefer.sort((a, b) => b.position - a.position);
                // console.log(toRefer);

                let referate = "";
                for (let sentence of toRefer) {
                    referate += sentence["sentence"];
                }

                let nonProcessedWords = tokenizer.tokenize(referate);
                let words = removeStopwords(nonProcessedWords, stopwordsLanguage);

                let keywords = [];
                let visited = [];
                for (let word of words) {
                    let processedWord = word.toLowerCase();

                    if (visited.includes(processedWord)) {
                        continue;
                    }
                    visited.push(processedWord);

                    let stemmedWord = stemmer.stem(word);
                    let value = (tf[stemmedWord] || 0) * documents[language].length / (df[stemmedWord] || 1);

                    if (value > 0 && processedWord.length > 2) {
                        keywords.push([processedWord, value]);
                    }
                }

                keywords.sort((a, b) => b[1] - a[1]);
                keywords = keywords.slice(0, 20);


                referates.push({
                    "referate": referate,
                    "keywords": keywords.map((e) => e[0]),
                    "document": document,
                    "language": language
                });
            }

            return referates;
        }
    }
}

class MLReferator {
    constructor() {
        this.dictionary = [];
        this.model = tf.sequential();
    }

    async train(documents) {
        let trainX = [];
        let trainY = [];

        let sentenceTokenizer = new natural.SentenceTokenizer();

        let tfsByLanguage = {};
        let tfsMaxesByLanguage = {};
        let dfsByLanguage = {};

        let overallTfByLanguage = {};
        for (let language in documents) {
            let tokenizer = null;

            let tfs = [];
            let tfs_maxes = [];

            let stopwordsLanguage = null;
            let stemmer = null;

            if (language == "ru") {
                tokenizer = new Tokenizer(/[а-яА-Я]+/g);
                stopwordsLanguage = rus;
                stemmer = natural.PorterStemmer;
            } else {
                tokenizer = new Tokenizer(/[a-zA-Z]+/g)
                stopwordsLanguage = eng;
                stemmer = natural.PorterStemmerRu;
            }

            let overallTf = {}
            let df = {};
            for (let document of documents[language]) {
                let tf = {};

                let nonProcessedWords = tokenizer.tokenize(document);
                let words = removeStopwords(nonProcessedWords, stopwordsLanguage);

                let dfCounted = [];
                for (let word of words) {
                    let stemmedWord = stemmer.stem(word);

                    tf[stemmedWord] = (tf[stemmedWord] || 0) + 1
                    overallTf[stemmedWord] = (overallTf[stemmedWord] || 0) + 1;

                    if (!dfCounted.includes(stemmedWord)) {
                        dfCounted.push(stemmedWord);
                        df[stemmedWord] = (df[stemmedWord] || 0) + 1;
                    }
                }

                let maxFreq = null;
                for (let word in tf) {
                    if (maxFreq == null || tf[word] > maxFreq) {
                        maxFreq = tf[word];
                    }
                }

                tfs.push(tf);
                tfs_maxes.push(maxFreq);
            }

            tfsByLanguage[language] = tfs;
            tfsMaxesByLanguage[language] = tfs_maxes;
            dfsByLanguage[language] = df;
            overallTfByLanguage[language] = overallTf;
        }

        for (let language in overallTfByLanguage) {
            let overallTf = overallTfByLanguage[language];
            let df = dfsByLanguage[language];

            let stemmer = null;

            if (language == "ru") {
                stemmer = natural.PorterStemmer;
            } else {
                stemmer = natural.PorterStemmerRu;
            }

            let wordsWeight = {};
            let average = 0.0;
            let countOfWords = 0;
            for (let word in overallTf) {
                let stemmedWord = stemmer.stem(word);
                wordsWeight[stemmedWord] = overallTf[stemmedWord] * documents[language].length / df[stemmedWord];
                average += wordsWeight[stemmedWord];
                countOfWords++;
            }

            average /= countOfWords;

            for (let word in wordsWeight) {
                if (wordsWeight[word] > average) {
                    this.dictionary.push(word);
                }
            }
        }

        this.dictionary.sort();

        this.model.add(tf.layers.dense({ inputShape: this.dictionary.length * 3 + 2, units: 32, activation: "linear" }));
        this.model.add(tf.layers.dense({ units: 1, activation: "linear" }));``

        this.model.compile({loss: 'meanSquaredError', optimizer: 'adam'});

        for (let language in documents) {
            let tokenizer = null;
            let stopwordsLanguage = null;
            let stemmer = null;

            if (language == "ru") {
                tokenizer = new Tokenizer(/[а-яА-Я]+/g);
                stopwordsLanguage = rus;
                stemmer = natural.PorterStemmer;
            } else {
                tokenizer = new Tokenizer(/[a-zA-Z]+/g)
                stopwordsLanguage = eng;
                stemmer = natural.PorterStemmerRu;
            }

            let counter = 0;
            for (let document of documents[language]) {
                let tf = tfsByLanguage[language][counter];
                let tf_max = tfsMaxesByLanguage[language][counter];
                let df = dfsByLanguage[language];

                let sentences = sentenceTokenizer.tokenize(document);
                for (let i = 0; i < sentences.length; i++) {
                    let currentSentence = sentences[i];
                    let nonProcessedWords = tokenizer.tokenize(currentSentence);
                    let words = removeStopwords(nonProcessedWords, stopwordsLanguage);

                    let sentenceTf = {};
                    for (let word of words) {
                        let stemmedWord = stemmer.stem(word);

                        sentenceTf[stemmedWord] = (sentenceTf[stemmedWord] || 0) + 1;
                    }

                    let sentenceRating = 0.0;
                    for (let word in sentenceTf) {
                        let stemmedWord = stemmer.stem(word);
                        sentenceRating += (sentenceTf[stemmedWord] || 0) * 0.5 * (1 + (tf[stemmedWord] || 0) / tf_max) * Math.log(documents[language].length / (df[stemmedWord] || 1));
                    }

                    let neuralInput = [];
                    // First add Sentence tfs
                    for (let stemmedWord of this.dictionary) {
                        neuralInput.push(sentenceTf[stemmedWord] || 0);
                    }

                    // Then add tf
                    for (let stemmedWord of this.dictionary) {
                        neuralInput.push(tf[stemmedWord] || 0);
                    }

                    // Then df
                    for (let stemmedWord of this.dictionary) {
                        neuralInput.push(df[stemmedWord] || 0);
                    }

                    neuralInput.push(tf_max);
                    neuralInput.push(documents[language].length);

                    trainX.push(
                        neuralInput
                    );

                    trainY.push(
                        sentenceRating
                    );
                }
            }

            // for (let value of trainData[0].input) {
            //     console.log(value + " ");
            // }

            

            // this.model.train(
            //     trainX,
            //     {
            //         iterations: 50000, // Количество итераций обучения
            //         errorThresh: 1e-9, // Порог ошибки
            //         log: true, // Выводить прогресс обучения
            //         logPeriod: 5,
            //     }
            // );3
        }

        const xs = tf.tensor2d(trainX);
        const ys = tf.tensor2d(trainY, [trainY.length, 1]);
        await this.model.fit(xs, ys, {epochs: 100});
    }

    referate(documents) {
        let sentenceTokenizer = new natural.SentenceTokenizer();
        let referates = [];

        let tfsByLanguage = {};
        let tfsMaxesByLanguage = {};
        let dfsByLanguage = {};

        for (let language in documents) {
            let tokenizer = null;

            let tfs = [];
            let tfs_maxes = [];

            let stopwordsLanguage = null;
            let stemmer = null;

            if (language == "ru") {
                tokenizer = new Tokenizer(/[а-яА-Я]+/g);
                stopwordsLanguage = rus;
                stemmer = natural.PorterStemmer;
            } else {
                tokenizer = new Tokenizer(/[a-zA-Z]+/g)
                stopwordsLanguage = eng;
                stemmer = natural.PorterStemmerRu;
            }

            let df = {};
            for (let document of documents[language]) {
                let tf = {};

                let nonProcessedWords = tokenizer.tokenize(document);
                let words = removeStopwords(nonProcessedWords, stopwordsLanguage);

                let dfCounted = [];
                for (let word of words) {
                    let stemmedWord = stemmer.stem(word);

                    tf[stemmedWord] = (tf[stemmedWord] || 0) + 1

                    if (!dfCounted.includes(stemmedWord)) {
                        dfCounted.push(stemmedWord);
                        df[stemmedWord] = (df[stemmedWord] || 0) + 1;
                    }
                }

                let maxFreq = null;
                for (let word in tf) {
                    if (maxFreq == null || tf[word] > maxFreq) {
                        maxFreq = tf[word];
                    }
                }

                tfs.push(tf);
                tfs_maxes.push(maxFreq);
            }

            tfsByLanguage[language] = tfs;
            tfsMaxesByLanguage[language] = tfs_maxes;
            dfsByLanguage[language] = df;
        }

        this.dictionary.sort();

        for (let language in documents) {
            let tokenizer = null;
            let stopwordsLanguage = null;
            let stemmer = null;

            if (language == "ru") {
                tokenizer = new Tokenizer(/[а-яА-Я]+/g);
                stopwordsLanguage = rus;
                stemmer = natural.PorterStemmer;
            } else {
                tokenizer = new Tokenizer(/[a-zA-Z]+/g)
                stopwordsLanguage = eng;
                stemmer = natural.PorterStemmerRu;
            }

            let counter = 0;
            for (let document of documents[language]) {
                let tttf = tfsByLanguage[language][counter];
                let df = dfsByLanguage[language];
                let tf_max = tfsMaxesByLanguage[language][counter];

                let sentences = sentenceTokenizer.tokenize(document);

                let ratings = [];
                for (let i = 0; i < sentences.length; i++) {
                    let currentSentence = sentences[i];
                    let nonProcessedWords = tokenizer.tokenize(currentSentence);
                    let words = removeStopwords(nonProcessedWords, stopwordsLanguage);

                    let sentenceTf = {};
                    for (let word of words) {
                        let stemmedWord = stemmer.stem(word);

                        sentenceTf[stemmedWord] = (sentenceTf[stemmedWord] || 0) + 1;
                    }

                    let neuralInput = [];
                    // First add Sentence tfs
                    for (let stemmedWord of this.dictionary) {
                        neuralInput.push(sentenceTf[stemmedWord] || 0);
                    }

                    // Then add tf
                    for (let stemmedWord of this.dictionary) {
                        neuralInput.push(tttf[stemmedWord] || 0);
                    }

                    // Then df
                    for (let stemmedWord of this.dictionary) {
                        neuralInput.push(df[stemmedWord] || 0);
                    }

                    neuralInput.push(tf_max);
                    neuralInput.push(documents[language].length);

                    ratings.push({
                        "position": i,
                        "rating": this.model.predict(tf.tensor2d(neuralInput, [1, neuralInput.length])).dataSync()[0],
                        "sentence": currentSentence
                    });
                }

                ratings.sort((a, b) => b.rating - a.rating);
                let toRefer = ratings.slice(0, Math.min(10, ratings.length));

                toRefer.sort((a, b) => b.position - a.position);

                let referate = "";
                for (let sentence of toRefer) {
                    referate += sentence["sentence"];
                }

                let nonProcessedWords = tokenizer.tokenize(referate);
                let words = removeStopwords(nonProcessedWords, stopwordsLanguage);

                let keywords = [];
                let visited = [];
                for (let word of words) {
                    let processedWord = word.toLowerCase();

                    if (visited.includes(processedWord)) {
                        continue;
                    }
                    visited.push(processedWord);

                    let stemmedWord = stemmer.stem(word);
                    let value = (tttf[stemmedWord] || 0) * documents[language].length / (df[stemmedWord] || 1);

                    if (value > 0 && processedWord.length > 2) {
                        keywords.push([processedWord, value]);
                    }
                }

                keywords.sort((a, b) => b[1] - a[1]);
                keywords = keywords.slice(0, 20);

                referates.push({
                    "referate": referate,
                    "keywords": keywords.map((e) => e[0]),
                    "document": document,
                    "language": language
                });

                counter ++;
            }
        }

        return referates
    }

    async save(filename) {
        await this.model.save("file://./" + filename);
        saveToJSON(this.dictionary, "dictionary" + filename);
        // saveToJSON(this.model.toJSON(), filename);
    }

    async load(filename) {
        try {
            this.model = await tf.loadLayersModel("file://./" + filename + "/model.json");
        } catch {
            this.model = tf.sequential();
            this.dictionary = [];
            return false;
        }

        let loadedDictionary = loadFromJSON("dictionary" + filename);


        if (! loadedDictionary) {
            return false;
        }

        this.dictionary = loadedDictionary;

        return true;
        // let loadedModel = loadFromJSON(filename);

        // if (!loadedModel || !loadedDictionary) {
        //     return false;
        // }

        // this.model.fromJSON(loadedModel);
        // this.dictionary = loadedDictionary;

        // return true;
    }
}

let groupByLanguage = (documents) => {
    let textsByLanguage = {};
    let languageDetector = new LanguageDetect();

    for (let text of documents) {
        let detectionInfo = languageDetector.detect(text);

        let language = null;
        let english = null;
        let russian = null;
        for (let infoEntry of detectionInfo) {
            if (infoEntry[0] == 'english') {
                english = infoEntry[1];
            } else if (infoEntry[0] == 'russian') {
                russian = infoEntry[1]
            }
        }

        if (russian == null) {
            language = "eng";
        } else if (english == null) {
            language = "ru";
        } else if (english >= russian) {
            language = 'eng';
        } else {
            language = 'ru';
        }

        textsByLanguage[language] = (textsByLanguage[language] || []).concat([text]);
    }

    return textsByLanguage;
}

let getReferateNN = async (documents) => {
    const modelFile = "nn_model";
    let model = new MLReferator();

    if (!(await model.load(modelFile))) {
        const trainTextsFolder = "toTrain";
        let trainTexts = await processFolder(trainTextsFolder);
        await model.train(groupByLanguage(trainTexts));

        await model.save(modelFile);
    }

    // const trainTextsFolder = "toTrain";
    // let trainTexts = await processFolder(trainTextsFolder);
    // await model.train(groupByLanguage(trainTexts));

    return model.referate(groupByLanguage(documents));
}

let getReferateSE = (documents) => {
    let sentenceExtraction = new SentenceExtraction();
    return sentenceExtraction.referate(groupByLanguage(documents));
}

let main = async () => {
    const trainTextsFolder = "toTrain";
    let textsToReferate = await processFolder(trainTextsFolder);

    console.log(await getReferateNN(textsToReferate));
}

main();