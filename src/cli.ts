#!/usr/bin/env node
import { formatHelp } from './help.js';

process.stdout.write(`${formatHelp()}\n`);
